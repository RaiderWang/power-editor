//! Tauri commands for folder search: a background job that streams throttled
//! `workspace-search:batch` events and ends with one `workspace-search:done`.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::search::build_regex;
use crate::workspace_search::{self, SearchBatch, SearchSummary, WorkspaceSearchParams};
use crate::AppState;

#[derive(Clone, Serialize)]
struct BatchPayload {
    job_id: String,
    #[serde(flatten)]
    batch: SearchBatch,
}

#[derive(Clone, Serialize)]
struct DonePayload {
    job_id: String,
    #[serde(flatten)]
    summary: SearchSummary,
}

/// Start a folder search. Returns as soon as the job is running (invalid input is
/// reported synchronously); results arrive through events tagged with `job_id`.
/// Starting a search cancels every older one.
#[tauri::command]
pub async fn workspace_search_start(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    params: WorkspaceSearchParams,
) -> Result<(), String> {
    if params.search.pattern.is_empty() {
        return Err("Empty search pattern".to_string());
    }
    if !Path::new(&params.root).is_dir() {
        return Err(format!("Not a directory: {}", params.root));
    }
    let re = build_regex(&params.search).map_err(|e| e.to_string())?;

    let (cancel, guard) = state.workspace_search_jobs.begin(&job_id);
    tokio::task::spawn_blocking(move || {
        // Unregisters the job when the closure ends (or unwinds).
        let _guard = guard;
        let batch_app = app.clone();
        let batch_job = job_id.clone();
        let summary = workspace_search::walk::run(&params, &re, &cancel, &move |batch| {
            let _ = batch_app.emit(
                "workspace-search:batch",
                BatchPayload { job_id: batch_job.clone(), batch },
            );
        });
        let _ = app.emit("workspace-search:done", DonePayload { job_id, summary });
    });
    Ok(())
}

/// Stop a running folder search. Returns whether it was running.
#[tauri::command]
pub fn workspace_search_cancel(state: State<'_, AppState>, job_id: String) -> bool {
    state.workspace_search_jobs.cancel(&job_id)
}
