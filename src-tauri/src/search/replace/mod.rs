//! Replace All on a rope clone, committed in one step.
//!
//! Flow (see also `crate::replace_commands`):
//!
//! 1. `prepare`: under the registry lock take an O(1) `Rope::clone` + the buffer
//!    `revision`, then release the lock.
//! 2. `compute`: build the replaced text. The rope is cut into line-aligned
//!    segments scanned by several threads when the pattern allows it
//!    (`eligibility`), otherwise scanned sequentially in windows. Segments without
//!    a match are shared, not copied; matched segments are rebuilt through a
//!    `RopeBuilder`; the pieces are re-joined with `Rope::append`.
//! 3. `commit`: under the lock again, if the buffer was not edited meanwhile
//!    (`revision`), keep the old rope as the undo snapshot and swap in the new one.
//!
//! A cancelled or failed run therefore leaves the buffer untouched.

pub mod jobs;
pub mod progress;
mod segment;
mod sink;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use ropey::Rope;
use serde::Serialize;

use super::scan::{scan_rope, Cancelled, ScanConfig, ScanControl};
use super::{build_regex, eligibility, SearchParams};
use crate::buffer::{BufferRegistry, FileInfo};
use progress::ReplaceControl;
use segment::{split_segments, SEGMENT_TARGET};
use sink::ReplaceSink;

/// Result of a completed (non-cancelled) Replace All.
#[derive(Debug, Clone, Serialize)]
pub struct ReplaceOutcome {
    pub count: usize,
    pub file_info: FileInfo,
}

/// Knobs for `compute_with`; production uses `Default`, tests shrink them.
#[derive(Debug, Clone, Copy)]
pub struct ReplaceOptions {
    pub scan: ScanConfig,
    pub segment_target: usize,
    pub allow_parallel: bool,
    pub max_workers: usize,
}

impl Default for ReplaceOptions {
    fn default() -> Self {
        ReplaceOptions {
            scan: ScanConfig::default(),
            segment_target: SEGMENT_TARGET,
            allow_parallel: true,
            max_workers: 16,
        }
    }
}

/// A rope clone plus the buffer revision it was taken at.
pub struct Prepared {
    pub rope: Rope,
    pub revision: u64,
}

pub fn prepare(registry: &BufferRegistry, buffer_id: u64) -> Result<Prepared> {
    let buffers = registry.buffers.lock().unwrap();
    let buffer = buffers
        .get(&buffer_id)
        .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;
    buffer.ensure_replaceable().map_err(|e| anyhow!(e))?;
    Ok(Prepared {
        rope: buffer.rope.clone(),
        revision: buffer.revision,
    })
}

pub fn current_info(registry: &BufferRegistry, buffer_id: u64) -> Result<FileInfo> {
    let buffers = registry.buffers.lock().unwrap();
    buffers
        .get(&buffer_id)
        .map(|b| b.file_info())
        .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))
}

/// Swap `new_rope` in, keeping the previous rope as the Replace All undo snapshot.
/// Fails (leaving the buffer untouched) if the text changed since `prepare`.
pub fn commit(
    registry: &BufferRegistry,
    buffer_id: u64,
    revision: u64,
    new_rope: Rope,
) -> Result<FileInfo> {
    let mut buffers = registry.buffers.lock().unwrap();
    let buffer = buffers
        .get_mut(&buffer_id)
        .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;
    buffer.ensure_replaceable().map_err(|e| anyhow!(e))?;
    if buffer.revision != revision {
        return Err(anyhow!(
            "The text was changed while Replace All was running; nothing was replaced"
        ));
    }

    let old_bytes = buffer.rope.len_bytes();
    // O(1) copy-on-write snapshot so the whole replacement can be undone.
    buffer.save_replace_snapshot();
    let new_bytes = new_rope.len_bytes();
    buffer.rope = new_rope;
    buffer.adjust_total_bytes(old_bytes, new_bytes);
    buffer.is_modified = true;
    buffer.revision = buffer.revision.wrapping_add(1);
    Ok(buffer.file_info())
}

/// Prepare → compute → commit. `Ok(None)` means cancelled (buffer untouched).
///
/// `make_ctl` receives the size of the text being processed (for progress totals)
/// and returns the control (cancel flag + progress reporter) for this run.
pub fn run(
    registry: &BufferRegistry,
    buffer_id: u64,
    params: &SearchParams,
    replacement: &str,
    make_ctl: impl FnOnce(u64) -> ReplaceControl,
) -> Result<Option<ReplaceOutcome>> {
    let prepared = prepare(registry, buffer_id)?;
    let ctl = make_ctl(prepared.rope.len_bytes() as u64);
    let Some((new_rope, count)) = compute(&prepared.rope, params, replacement, &ctl)? else {
        return Ok(None);
    };
    ctl.finish();
    let file_info = if count > 0 {
        commit(registry, buffer_id, prepared.revision, new_rope)?
    } else {
        current_info(registry, buffer_id)?
    };
    Ok(Some(ReplaceOutcome { count, file_info }))
}

/// Blocking Replace All without progress / cancellation; returns the match count.
pub fn replace_all(
    registry: &BufferRegistry,
    buffer_id: u64,
    params: &SearchParams,
    replacement: &str,
) -> Result<usize> {
    Ok(run(registry, buffer_id, params, replacement, ReplaceControl::silent)?.map_or(0, |o| o.count))
}

pub fn compute(
    rope: &Rope,
    params: &SearchParams,
    replacement: &str,
    ctl: &ReplaceControl,
) -> Result<Option<(Rope, usize)>> {
    compute_with(rope, params, replacement, ctl, &ReplaceOptions::default())
}

/// Build the replaced rope. `Ok(None)` = cancelled; a count of 0 returns the
/// input rope unchanged.
pub fn compute_with(
    rope: &Rope,
    params: &SearchParams,
    replacement: &str,
    ctl: &ReplaceControl,
    opts: &ReplaceOptions,
) -> Result<Option<(Rope, usize)>> {
    let re = build_regex(params)?;
    // Plain-text mode inserts the replacement verbatim; in regex mode a `$` may
    // be `$1`, `${name}`, `$$`, `$0`, `$unknown` ... so any `$` needs `expand`.
    let expand = params.is_regex && replacement.contains('$');
    let parallel = opts.allow_parallel && eligibility::can_parallelize(params);

    if parallel {
        let segs = split_segments(rope, opts.segment_target);
        if segs.len() > 1 {
            return run_parallel(rope, segs, &re, replacement, expand, ctl, opts);
        }
    }
    run_sequential(rope, &re, replacement, expand, ctl, opts)
}

fn run_sequential(
    rope: &Rope,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    ctl: &ReplaceControl,
    opts: &ReplaceOptions,
) -> Result<Option<(Rope, usize)>> {
    let mut sink = ReplaceSink::new(rope, replacement, expand);
    let mut buf = String::new();
    match scan_rope(rope, true, re, expand, &mut sink, ctl, &opts.scan, &mut buf) {
        Err(Cancelled) => Ok(None),
        Ok(()) => Ok(Some(sink.finish().unwrap_or_else(|| (rope.clone(), 0)))),
    }
}

fn run_parallel(
    rope: &Rope,
    segs: Vec<Rope>,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    ctl: &ReplaceControl,
    opts: &ReplaceOptions,
) -> Result<Option<(Rope, usize)>> {
    let n = segs.len();
    let workers = std::thread::available_parallelism()
        .map(|c| c.get())
        .unwrap_or(2)
        .clamp(1, opts.max_workers.max(1))
        .min(n);

    let next = AtomicUsize::new(0);
    let cancelled = AtomicBool::new(false);
    let results: Vec<Mutex<Option<(Rope, usize)>>> = (0..n).map(|_| Mutex::new(None)).collect();

    std::thread::scope(|scope| {
        for _ in 0..workers {
            // A per-thread `Regex` clone avoids contention on its internal cache pool.
            let re = re.clone();
            let (segs, results, next, cancelled) = (&segs, &results, &next, &cancelled);
            scope.spawn(move || {
                // One reusable window buffer per worker thread.
                let mut buf = String::new();
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= n {
                        break;
                    }
                    if ctl.is_cancelled() || cancelled.load(Ordering::Relaxed) {
                        cancelled.store(true, Ordering::Relaxed);
                        break;
                    }
                    let seg = &segs[i];
                    let mut sink = ReplaceSink::new(seg, replacement, expand);
                    let scanned = scan_rope(seg, i + 1 == n, &re, expand, &mut sink, ctl, &opts.scan, &mut buf);
                    match scanned {
                        Err(Cancelled) => {
                            cancelled.store(true, Ordering::Relaxed);
                            break;
                        }
                        Ok(()) => {
                            if let Some(done) = sink.finish() {
                                *results[i].lock().unwrap() = Some(done);
                            }
                        }
                    }
                }
            });
        }
    });

    if cancelled.load(Ordering::Relaxed) {
        return Ok(None);
    }

    let results: Vec<Option<(Rope, usize)>> = results
        .into_iter()
        .map(|m| m.into_inner().unwrap())
        .collect();
    let total: usize = results.iter().flatten().map(|(_, c)| *c).sum();
    if total == 0 {
        return Ok(Some((rope.clone(), 0)));
    }

    // Re-join in order; unmatched segments are the shared originals.
    let mut out = Rope::new();
    for (seg, res) in segs.into_iter().zip(results) {
        out.append(match res {
            Some((replaced, _)) => replaced,
            None => seg,
        });
    }
    Ok(Some((out, total)))
}

#[cfg(test)]
mod tests;
