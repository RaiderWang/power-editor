//! Cancellation flag + throttled progress reporting for a running Replace All.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::search::scan::ScanControl;

/// Minimum interval between progress callbacks (keeps IPC from flooding).
pub const PROGRESS_THROTTLE_MS: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProgressSnapshot {
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub matches: u64,
}

pub type Reporter = Box<dyn Fn(ProgressSnapshot) + Send + Sync>;

pub struct ReplaceControl {
    cancel: Arc<AtomicBool>,
    total_bytes: u64,
    done: AtomicU64,
    matches: AtomicU64,
    started: Instant,
    last_emit_ms: AtomicU64,
    reporter: Option<Reporter>,
}

impl ReplaceControl {
    pub fn new(cancel: Arc<AtomicBool>, total_bytes: u64, reporter: Option<Reporter>) -> Self {
        ReplaceControl {
            cancel,
            total_bytes,
            done: AtomicU64::new(0),
            matches: AtomicU64::new(0),
            started: Instant::now(),
            last_emit_ms: AtomicU64::new(0),
            reporter,
        }
    }

    /// A control that is never cancelled and reports nothing.
    pub fn silent(total_bytes: u64) -> Self {
        Self::new(Arc::new(AtomicBool::new(false)), total_bytes, None)
    }

    pub fn snapshot(&self) -> ProgressSnapshot {
        ProgressSnapshot {
            bytes_done: self.done.load(Ordering::Relaxed).min(self.total_bytes),
            total_bytes: self.total_bytes,
            matches: self.matches.load(Ordering::Relaxed),
        }
    }

    /// Emit a final 100% report (call after a successful, non-cancelled run).
    pub fn finish(&self) {
        if let Some(r) = &self.reporter {
            let mut s = self.snapshot();
            s.bytes_done = s.total_bytes;
            r(s);
        }
    }

    fn maybe_report(&self) {
        let Some(r) = &self.reporter else { return };
        let now = self.started.elapsed().as_millis() as u64;
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        if now.saturating_sub(last) < PROGRESS_THROTTLE_MS {
            return;
        }
        // Only one thread wins the slot, so concurrent workers emit once per tick.
        if self
            .last_emit_ms
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            r(self.snapshot());
        }
    }
}

impl ScanControl for ReplaceControl {
    fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn add_done(&self, n: usize) {
        self.done.fetch_add(n as u64, Ordering::Relaxed);
        self.maybe_report();
    }

    fn add_matches(&self, n: usize) {
        self.matches.fetch_add(n as u64, Ordering::Relaxed);
        self.maybe_report();
    }
}
