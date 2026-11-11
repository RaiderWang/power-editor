//! Tauri commands for Replace All: a background job with throttled progress
//! events (`replace:progress`) that can be cancelled.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::search::replace::progress::ReplaceControl;
use crate::search::replace::{self, ReplaceOutcome};
use crate::search::SearchParams;
use crate::AppState;

/// Payload of the `replace:progress` event.
#[derive(Clone, Serialize)]
struct ReplaceProgressPayload {
    buffer_id: u64,
    bytes_done: u64,
    total_bytes: u64,
    matches: u64,
}

/// Replace every match in the buffer.
///
/// Runs on a blocking worker (never on the UI thread) over an O(1) rope clone and
/// commits in one step, so the buffer is untouched on cancel / error. Returns
/// `None` when cancelled, otherwise the match count and the refreshed `FileInfo`.
#[tauri::command]
pub async fn replace_all(
    app: AppHandle,
    state: State<'_, AppState>,
    buffer_id: u64,
    params: SearchParams,
    replacement: String,
) -> Result<Option<ReplaceOutcome>, String> {
    let registry = state.registry.clone();
    let (cancel, guard) = state
        .replace_jobs
        .begin(buffer_id)
        .map_err(|e| e.to_string())?;

    tokio::task::spawn_blocking(move || {
        // Unregisters the job when the closure ends (or unwinds).
        let _guard = guard;
        replace::run(&registry, buffer_id, &params, &replacement, move |total_bytes| {
            let reporter = Box::new(move |s: replace::progress::ProgressSnapshot| {
                let _ = app.emit(
                    "replace:progress",
                    ReplaceProgressPayload {
                        buffer_id,
                        bytes_done: s.bytes_done,
                        total_bytes: s.total_bytes,
                        matches: s.matches,
                    },
                );
            });
            ReplaceControl::new(cancel, total_bytes, Some(reporter))
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Ask a running Replace All of this buffer to stop. Returns whether one was running.
#[tauri::command]
pub fn cancel_replace_all(state: State<'_, AppState>, buffer_id: u64) -> bool {
    state.replace_jobs.cancel(buffer_id)
}