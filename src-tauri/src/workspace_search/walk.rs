//! Parallel directory walk + per-file matching + throttled batching.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use ignore::{DirEntry, WalkBuilder, WalkState};
use regex::Regex;

use super::content;
use super::types::{FileHit, SearchBatch, SearchMode, SearchSummary, WorkspaceSearchParams};

/// Global caps: stop the search (and tell the UI) beyond these.
const MAX_HIT_FILES_CONTENT: u64 = 2000;
const MAX_HIT_FILES_NAME: u64 = 5000;
const MAX_HITS: u64 = 5000;

/// Global result caps of one search. The result is flagged `truncated` only when a hit
/// *beyond* the cap was actually found (reaching the cap exactly is not truncation).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    /// Maximum number of hit files.
    pub max_files: u64,
    /// Maximum number of hit lines (content mode only; name mode counts files).
    pub max_hits: u64,
}

impl Limits {
    pub(crate) fn for_mode(mode: SearchMode) -> Self {
        Self {
            max_files: match mode {
                SearchMode::Name => MAX_HIT_FILES_NAME,
                SearchMode::Content => MAX_HIT_FILES_CONTENT,
            },
            max_hits: MAX_HITS,
        }
    }
}

/// A batch is flushed after this long or after `BATCH_FILES` files.
const BATCH_INTERVAL: Duration = Duration::from_millis(80);
const BATCH_FILES: usize = 50;

/// Extensions that are never text: skipped without opening the file (content mode).
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tif", "tiff", "psd", "heic", "avif",
    "mp3", "mp4", "wav", "flac", "ogg", "m4a", "mkv", "avi", "mov", "wmv", "webm",
    "zip", "rar", "7z", "gz", "tgz", "tar", "xz", "bz2", "zst", "cab",
    "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "pdb", "class", "jar", "wasm",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "ttf", "otf", "woff", "woff2", "eot",
    "sqlite", "db", "iso", "dmg", "msi", "nupkg",
];

fn has_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| BINARY_EXTENSIONS.iter().any(|b| e.eq_ignore_ascii_case(b)))
        .unwrap_or(false)
}

/// Directories never worth entering. `node_modules` only when ignore rules are on.
fn keep_entry(entry: &DirEntry, include_ignored: bool) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_some_and(|t| t.is_dir()) {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    match name.as_ref() {
        ".git" | ".svn" | ".hg" => false,
        "node_modules" => include_ignored,
        _ => true,
    }
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

#[derive(Default)]
struct Counters {
    scanned: AtomicU64,
    hit_files: AtomicU64,
    hit_count: AtomicU64,
    skipped_binary: AtomicU64,
    long_cuts: AtomicU64,
    /// A global cap was reached.
    capped: AtomicBool,
}

impl Counters {
    fn snapshot(&self, files: Vec<FileHit>) -> SearchBatch {
        SearchBatch {
            files,
            scanned_files: self.scanned.load(Ordering::Relaxed),
            hit_files: self.hit_files.load(Ordering::Relaxed),
            hit_count: self.hit_count.load(Ordering::Relaxed),
        }
    }
}

/// Collects hits from the walker threads and emits them in throttled batches.
fn emitter(rx: mpsc::Receiver<FileHit>, counters: &Counters, emit: &(dyn Fn(SearchBatch) + Sync)) {
    let mut pending: Vec<FileHit> = Vec::new();
    let mut last_emit = Instant::now();
    let mut last_scanned = 0u64;
    loop {
        let disconnected = match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(file) => {
                pending.push(file);
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };
        let due = last_emit.elapsed() >= BATCH_INTERVAL;
        if !pending.is_empty() && (pending.len() >= BATCH_FILES || due || disconnected) {
            last_scanned = counters.scanned.load(Ordering::Relaxed);
            emit(counters.snapshot(std::mem::take(&mut pending)));
            last_emit = Instant::now();
        } else if due && pending.is_empty() && counters.scanned.load(Ordering::Relaxed) != last_scanned {
            // Progress-only heartbeat so the UI shows that scanning goes on.
            last_scanned = counters.scanned.load(Ordering::Relaxed);
            emit(counters.snapshot(Vec::new()));
            last_emit = Instant::now();
        }
        if disconnected {
            break;
        }
    }
}

fn name_hit(entry: &DirEntry, root: &Path, re: &Regex) -> Option<FileHit> {
    let name = entry.file_name().to_string_lossy().into_owned();
    let m = re.find(&name)?;
    let hl = (utf16_len(&name[..m.start()]), utf16_len(&name[..m.end()]));
    Some(FileHit {
        path: entry.path().to_string_lossy().into_owned(),
        rel_path: rel_path(entry.path(), root),
        name,
        encoding: String::new(),
        name_hl: Some(hl),
        hits: Vec::new(),
        more: false,
    })
}

fn rel_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn content_hit(
    entry: &DirEntry,
    root: &Path,
    re: &Regex,
    cancel: &AtomicBool,
    counters: &Counters,
) -> Option<FileHit> {
    if has_binary_extension(entry.path()) {
        counters.skipped_binary.fetch_add(1, Ordering::Relaxed);
        return None;
    }
    let scan = match content::scan_file(entry.path(), re, cancel) {
        Ok(s) => s,
        Err(_) => return None, // unreadable (locked, permissions…): ignore silently
    };
    if scan.binary {
        counters.skipped_binary.fetch_add(1, Ordering::Relaxed);
        return None;
    }
    counters.long_cuts.fetch_add(scan.long_cuts, Ordering::Relaxed);
    if scan.hits.is_empty() {
        return None;
    }
    Some(FileHit {
        path: entry.path().to_string_lossy().into_owned(),
        rel_path: rel_path(entry.path(), root),
        name: entry.file_name().to_string_lossy().into_owned(),
        encoding: scan.encoding,
        name_hl: None,
        hits: scan.hits,
        more: scan.more,
    })
}

/// Run a folder search. `emit` receives throttled batches (from a helper thread);
/// the call returns when the walk is finished, cancelled or capped.
pub fn run(
    params: &WorkspaceSearchParams,
    re: &Regex,
    cancel: &AtomicBool,
    emit: &(dyn Fn(SearchBatch) + Sync),
) -> SearchSummary {
    run_with_limits(params, re, cancel, emit, Limits::for_mode(params.mode))
}

/// [`run`] with explicit result caps (tests use tiny ones).
pub(crate) fn run_with_limits(
    params: &WorkspaceSearchParams,
    re: &Regex,
    cancel: &AtomicBool,
    emit: &(dyn Fn(SearchBatch) + Sync),
    limits: Limits,
) -> SearchSummary {
    let started = Instant::now();
    let root = Path::new(&params.root);
    let counters = Counters::default();

    let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).clamp(2, 8);
    let include_ignored = params.include_ignored;
    let mut builder = WalkBuilder::new(root);
    builder
        .threads(threads)
        .follow_links(false)
        .require_git(false)
        .standard_filters(!include_ignored)
        .filter_entry(move |e| keep_entry(e, include_ignored));
    let walker = builder.build_parallel();

    let (tx, rx) = mpsc::channel::<FileHit>();
    let mode = params.mode;

    std::thread::scope(|scope| {
        let counters = &counters;
        scope.spawn(move || emitter(rx, counters, emit));

        walker.run(|| {
            let tx = tx.clone();
            Box::new(move |result| {
                if cancel.load(Ordering::Relaxed) || counters.capped.load(Ordering::Relaxed) {
                    return WalkState::Quit;
                }
                let Ok(entry) = result else {
                    return WalkState::Continue;
                };
                if !entry.file_type().is_some_and(|t| t.is_file()) {
                    return WalkState::Continue;
                }
                counters.scanned.fetch_add(1, Ordering::Relaxed);

                let hit = match mode {
                    SearchMode::Name => name_hit(&entry, root, re),
                    SearchMode::Content => content_hit(&entry, root, re, cancel, counters),
                };
                if let Some(file) = hit {
                    // A hit found while a cap is already full proves there is more than
                    // we show: that (and only that) is truncation. Several walker threads
                    // may overshoot a cap by a few files, which is harmless.
                    let hits_full = mode == SearchMode::Content
                        && counters.hit_count.load(Ordering::Relaxed) >= limits.max_hits;
                    // The file slot is reserved atomically, so `hit_files` never exceeds
                    // `max_files`; the hit-line budget may overshoot by one file's hits.
                    let reserved = !hits_full
                        && counters
                            .hit_files
                            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                                (n < limits.max_files).then_some(n + 1)
                            })
                            .is_ok();
                    if !reserved {
                        counters.capped.store(true, Ordering::Relaxed);
                        return WalkState::Quit;
                    }
                    let added = match mode {
                        SearchMode::Name => 1,
                        SearchMode::Content => file.hits.len().max(1) as u64,
                    };
                    counters.hit_count.fetch_add(added, Ordering::Relaxed);
                    if tx.send(file).is_err() {
                        return WalkState::Quit;
                    }
                }
                WalkState::Continue
            })
        });
        // Dropping the last sender ends the emitter (it flushes what is left first).
        drop(tx);
    });

    SearchSummary {
        scanned_files: counters.scanned.load(Ordering::Relaxed),
        hit_files: counters.hit_files.load(Ordering::Relaxed),
        hit_count: counters.hit_count.load(Ordering::Relaxed),
        skipped_binary: counters.skipped_binary.load(Ordering::Relaxed),
        long_lines_cut: counters.long_cuts.load(Ordering::Relaxed),
        truncated: counters.capped.load(Ordering::Relaxed),
        cancelled: cancel.load(Ordering::Relaxed),
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}
