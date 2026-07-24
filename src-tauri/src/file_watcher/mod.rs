use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Wait this long after the **last** disk event before notifying the frontend.
/// Trailing-edge debounce: we do NOT fire on the first event but instead wait
/// for the file to stop changing.  This prevents reading a partially-written
/// file when the external editor uses a truncate-then-write strategy (as
/// opposed to an atomic write-temp-then-rename strategy).
const DEBOUNCE_MS: Duration = Duration::from_millis(500);

/// How often the background thread wakes to check for settled events.
const CHECK_INTERVAL: Duration = Duration::from_millis(50);

/// Watches files on disk and emits `file:externally-modified` Tauri events
/// when a watched file is changed by an external process.
///
/// The `record_save` method must be called after every buffer save so that
/// the watcher can distinguish the editor's own writes from external changes.
///
/// # Debounce strategy
///
/// This watcher uses **trailing-edge debounce**: every OS event refreshes a
/// per-buffer timestamp in `pending`.  A background thread wakes every
/// [`CHECK_INTERVAL`] and emits `file:externally-modified` for any buffer
/// whose last event is at least [`DEBOUNCE_MS`] old.  This guarantees that
/// we only read the file once it has stopped changing, avoiding the blank-
/// editor problem that occurs when an external editor truncates the file
/// before writing the new content.
pub struct FileWatcherRegistry {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Maps the canonical on-disk path to the buffer ID that opened it.
    path_to_buffer: Arc<Mutex<HashMap<PathBuf, u64>>>,
    /// Maps buffer_id → timestamp of the most recent disk event.
    /// Updated on every raw event; cleared once the debounce fires.
    pending: Arc<Mutex<HashMap<u64, Instant>>>,
    /// Maps buffer_id → timestamp of the most recent editor-initiated save.
    /// Used to suppress self-save watcher events.
    last_save: Arc<Mutex<HashMap<u64, Instant>>>,
}

impl FileWatcherRegistry {
    pub fn new(app: AppHandle) -> Self {
        let path_to_buffer: Arc<Mutex<HashMap<PathBuf, u64>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending: Arc<Mutex<HashMap<u64, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let last_save: Arc<Mutex<HashMap<u64, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // ── Background debounce thread ────────────────────────────────────
        // Wakes every CHECK_INTERVAL and emits the event for any buffer
        // whose last disk event has settled (no new events for DEBOUNCE_MS).
        {
            let pending_bg = pending.clone();
            let last_save_bg = last_save.clone();
            let app_bg = app.clone();
            std::thread::Builder::new()
                .name("file-watcher-debounce".into())
                .spawn(move || {
                    loop {
                        std::thread::sleep(CHECK_INTERVAL);
                        let now = Instant::now();
                        let mut to_fire: Vec<u64> = Vec::new();
                        {
                            let mut p = pending_bg.lock().unwrap();
                            let s = last_save_bg.lock().unwrap();
                            p.retain(|&buf_id, &mut event_ts| {
                                // Not settled yet – keep waiting.
                                if now.duration_since(event_ts) < DEBOUNCE_MS {
                                    return true;
                                }
                                // Suppress if this event was caused by our own save:
                                // the save timestamp must be earlier than the event
                                // (disk event happens *after* we write), and the
                                // gap must be within one debounce window.
                                if let Some(&save_ts) = s.get(&buf_id) {
                                    if event_ts <= save_ts + DEBOUNCE_MS {
                                        return false; // self-save – discard
                                    }
                                }
                                to_fire.push(buf_id);
                                false // remove from pending after firing
                            });
                        }
                        for buf_id in to_fire {
                            if let Err(e) = app_bg.emit("file:externally-modified", buf_id) {
                                log::warn!("[FileWatcher] failed to emit event: {e}");
                            }
                        }
                    }
                })
                .expect("[FileWatcher] failed to spawn debounce thread");
        }

        // ── File-system watcher ───────────────────────────────────────────
        let path_cb = path_to_buffer.clone();
        let pending_cb = pending.clone();

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
                    // Refresh the pending timestamp so the debounce window
                    // restarts from now (trailing-edge behaviour).
                    pending_cb.lock().unwrap().insert(buf_id, Instant::now());
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
            pending,
            last_save,
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
        self.pending.lock().unwrap().remove(&buffer_id);
        self.last_save.lock().unwrap().remove(&buffer_id);
    }

    /// Record that the editor just saved `buffer_id` so that the resulting OS
    /// event is treated as a self-save and suppressed.
    pub fn record_save(&self, buffer_id: u64) {
        self.last_save
            .lock()
            .unwrap()
            .insert(buffer_id, Instant::now());
    }
}
