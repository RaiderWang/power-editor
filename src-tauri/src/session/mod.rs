use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Per-tab session data persisted on app close.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabSession {
    /// Original file path. Empty string for unsaved new buffers.
    pub path: String,
    /// Path to scratch file holding unsaved content (only set when `is_modified`).
    pub scratch_path: Option<String>,
    pub cursor_line: usize,
    pub cursor_col: usize,
    pub scroll_top: f64,
    pub language: Option<String>,
    pub encoding: String,
    pub line_ending: String,
}

/// Full application session written to `app_data_dir/session.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSession {
    /// Index into `tabs` that was the active tab at close time.
    pub active_tab_index: usize,
    pub tabs: Vec<TabSession>,
}

// ──────────────────────────────────────────────────────────────
// Path helpers
// ──────────────────────────────────────────────────────────────

pub fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

pub fn scratch_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("scratch");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
