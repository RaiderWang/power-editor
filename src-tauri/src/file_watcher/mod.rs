use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Events arriving within this window after the previous event or a self-save
/// are suppressed (debounce + self-save filter).
const DEBOUNCE_MS: Duration = Duration::from_millis(500);

/// Watches files on disk and emits `file:externally-modified` Tauri events
/// when a watched file is changed by an external process.
///
/// The `record_save` method must be called after every buffer save so that
/// the watcher can distinguish the editor's own writes from external changes.
pub struct FileWatcherRegistry {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Maps the canonical on-disk path to the buffer ID that opened it.
    path_to_buffer: Arc<Mutex<HashMap<PathBuf, u64>>>,
    /// Tracks the last time an event was *emitted* or a *save was recorded*
    /// for each buffer.  Events arriving within DEBOUNCE_MS of the previous
    /// entry are dropped (handles self-saves and rapid OS-level flushes).
    last_activity: Arc<Mutex<HashMap<u64, Instant>>>,
}

impl FileWatcherRegistry {
    pub fn new(app: AppHandle) -> Self {
        let path_to_buffer: Arc<Mutex<HashMap<PathBuf, u64>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let last_activity: Arc<Mutex<HashMap<u64, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let path_cb = path_to_buffer.clone();
        let activity_cb = last_activity.clone();

        let watcher_result = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                let event = match result {
                    Ok(e) => e,
                    Err(e) => {
                        log::warn!("[FileWatcher] watch error: {e}");
                        return;
                    }
                };

                // Only care about file content changes.
                match event.kind {
                    EventKind::Modify(_) | EventKind::Create(_) => {}
                    _ => return,
                }

                for path in &event.paths {
                    let buf_id = {
                        let map = path_cb.lock().unwrap();
                        match map.get(path) {
                            Some(&id) => id,
                            None => continue,
                        }
                    };

                    // Debounce / self-save filter.
                    {
                        let mut activity = activity_cb.lock().unwrap();
                        let now = Instant::now();
                        if let Some(&last) = activity.get(&buf_id) {
                            if now.duration_since(last) < DEBOUNCE_MS {
                                continue;
                            }
                        }
                        activity.insert(buf_id, now);
                    }

                    if let Err(e) = app.emit("file:externally-modified", buf_id) {
                        log::warn!("[FileWatcher] failed to emit event: {e}");
                    }
                }
            },
            notify::Config::default(),
        );

        let watcher = match watcher_result {
            Ok(w) => {
                log::info!("[FileWatcher] watcher created successfully");
                Some(w)
            }
            Err(e) => {
                log::error!("[FileWatcher] could not create watcher: {e}");
                None
            }
        };

        FileWatcherRegistry {
            watcher: Mutex::new(watcher),
            path_to_buffer,
            last_activity,
        }
    }

    /// Start watching the file at `path` for the given `buffer_id`.
    /// No-op if the watcher is unavailable or the path is already watched.
    pub fn watch_buffer(&self, buffer_id: u64, path: PathBuf) {
        let mut guard = self.watcher.lock().unwrap();
        if let Some(ref mut w) = *guard {
            if let Err(e) = w.watch(&path, RecursiveMode::NonRecursive) {
                log::warn!("[FileWatcher] failed to watch {}: {e}", path.display());
                return;
            }
            self.path_to_buffer.lock().unwrap().insert(path, buffer_id);
        }
    }

    /// Stop watching the file associated with `buffer_id`.
    pub fn unwatch_buffer(&self, buffer_id: u64) {
        let path = {
            let map = self.path_to_buffer.lock().unwrap();
            map.iter()
                .find(|(_, &id)| id == buffer_id)
                .map(|(p, _)| p.clone())
        };
        if let Some(ref path) = path {
            let mut guard = self.watcher.lock().unwrap();
            if let Some(ref mut w) = *guard {
                let _ = w.unwatch(path);
            }
            self.path_to_buffer.lock().unwrap().remove(path);
        }
        self.last_activity.lock().unwrap().remove(&buffer_id);
    }

    /// Record that the editor just saved `buffer_id` so that the resulting OS
    /// event is treated as a self-save and suppressed.
    pub fn record_save(&self, buffer_id: u64) {
        self.last_activity
            .lock()
            .unwrap()
            .insert(buffer_id, Instant::now());
    }
}
