//! Registry of running Replace All jobs (one per buffer) so they can be cancelled.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};

#[derive(Default)]
pub struct ReplaceJobs {
    running: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

/// Unregisters the job when dropped (also on panic / early return).
pub struct JobGuard {
    jobs: Arc<ReplaceJobs>,
    buffer_id: u64,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        self.jobs.running.lock().unwrap().remove(&self.buffer_id);
    }
}

impl ReplaceJobs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a job for `buffer_id`. Fails when one is already running there.
    pub fn begin(self: &Arc<Self>, buffer_id: u64) -> Result<(Arc<AtomicBool>, JobGuard)> {
        let mut running = self.running.lock().unwrap();
        if running.contains_key(&buffer_id) {
            return Err(anyhow!("A Replace All is already running for this file"));
        }
        let flag = Arc::new(AtomicBool::new(false));
        running.insert(buffer_id, flag.clone());
        Ok((
            flag,
            JobGuard {
                jobs: self.clone(),
                buffer_id,
            },
        ))
    }

    /// Ask the job of `buffer_id` to stop. Returns `false` when none is running.
    pub fn cancel(&self, buffer_id: u64) -> bool {
        match self.running.lock().unwrap().get(&buffer_id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    pub fn cancel_all(&self) {
        for flag in self.running.lock().unwrap().values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_job_per_buffer_and_cancel_flag() {
        let jobs = Arc::new(ReplaceJobs::new());
        let (flag, guard) = jobs.begin(1).unwrap();
        assert!(jobs.begin(1).is_err());
        assert!(jobs.begin(2).is_ok());
        assert!(!flag.load(Ordering::Relaxed));
        assert!(jobs.cancel(1));
        assert!(flag.load(Ordering::Relaxed));
        drop(guard);
        assert!(!jobs.cancel(1));
        assert!(jobs.begin(1).is_ok());
    }
}
