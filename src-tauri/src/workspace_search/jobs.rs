//! Registry of running folder searches so they can be cancelled.
//! Starting a new search cancels every older one (only the latest query matters).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct WorkspaceSearchJobs {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Unregisters the job when dropped (also on panic / early return).
pub struct JobGuard {
    jobs: Arc<WorkspaceSearchJobs>,
    job_id: String,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        self.jobs.running.lock().unwrap().remove(&self.job_id);
    }
}

impl WorkspaceSearchJobs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancel all running jobs, then register `job_id` and return its cancel flag.
    pub fn begin(self: &Arc<Self>, job_id: &str) -> (Arc<AtomicBool>, JobGuard) {
        let mut running = self.running.lock().unwrap();
        for flag in running.values() {
            flag.store(true, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(false));
        running.insert(job_id.to_string(), flag.clone());
        (
            flag,
            JobGuard {
                jobs: self.clone(),
                job_id: job_id.to_string(),
            },
        )
    }

    /// Ask the job to stop. Returns `false` when it is not running.
    pub fn cancel(&self, job_id: &str) -> bool {
        match self.running.lock().unwrap().get(job_id) {
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
    fn new_job_cancels_older_ones() {
        let jobs = Arc::new(WorkspaceSearchJobs::new());
        let (a, guard_a) = jobs.begin("a");
        assert!(!a.load(Ordering::Relaxed));
        let (b, _guard_b) = jobs.begin("b");
        assert!(a.load(Ordering::Relaxed));
        assert!(!b.load(Ordering::Relaxed));
        drop(guard_a);
        assert!(!jobs.cancel("a"));
        assert!(jobs.cancel("b"));
        assert!(b.load(Ordering::Relaxed));
    }
}
