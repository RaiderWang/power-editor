pub mod buffer;
pub mod csv;
pub mod file_io;
pub mod file_watcher;
pub mod keybindings;
pub mod search;
pub mod session;
pub mod shell_integration;
pub mod wordfile;

use buffer::{BufferRegistry, EditOp, FileInfo, LineChunk};
use file_io::supported_encodings;
use file_watcher::FileWatcherRegistry;
use search::{FindResult, SearchParams};
use tauri::{Emitter, Manager};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use wordfile::WordfileDef;

/// Shared app state passed to all Tauri commands
pub struct AppState {
    pub registry: Arc<BufferRegistry>,
    pub watcher: Arc<FileWatcherRegistry>,
    /// File path passed as a CLI argument (e.g. opened via Explorer context menu).
    /// Read once by `get_startup_file` and then cleared.
    pub startup_file: std::sync::Mutex<Option<String>>,
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – File Operations
// ──────────────────────────────────────────────────────────────

#[tauri::command]
fn open_file(state: State<AppState>, path: String) -> Result<FileInfo, String> {
    let p = PathBuf::from(&path);
    let id = file_io::open_file(&state.registry, &p).map_err(|e| e.to_string())?;
    state.watcher.watch_buffer(id, p);
    let buffers = state.registry.buffers.lock().unwrap();
    let info = buffers[&id].file_info();
    Ok(info)
}

#[tauri::command]
fn new_buffer(state: State<AppState>) -> FileInfo {
    use ropey::Rope;
    let id = BufferRegistry::next_id();
    let buf = buffer::Buffer::from_rope(
        id,
        Rope::from_str(""),
        None,
        "UTF-8".to_string(),
        buffer::LineEnding::Lf,
    );
    state.registry.insert(buf);
    let buffers = state.registry.buffers.lock().unwrap();
    buffers[&id].file_info()
}

#[tauri::command]
fn close_buffer(state: State<AppState>, buffer_id: u64) {
    state.watcher.unwatch_buffer(buffer_id);
    state.registry.remove(buffer_id);
}

#[tauri::command]
fn save_buffer(state: State<AppState>, buffer_id: u64) -> Result<(), String> {
    // Record before the save so the watcher event (fired during persist/rename)
    // is suppressed even if it arrives before we return.
    state.watcher.record_save(buffer_id);
    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_buffer_as(state: State<AppState>, buffer_id: u64, path: String) -> Result<FileInfo, String> {
    let p = PathBuf::from(&path);
    state.watcher.record_save(buffer_id);
    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.save_as(p.clone()).map_err(|e| e.to_string())?;
    let info = buf.file_info();
    drop(buffers);
    // The file path may have changed (Save As to a new location); update the watch.
    state.watcher.unwatch_buffer(buffer_id);
    state.watcher.watch_buffer(buffer_id, p);
    Ok(info)
}

/// Reload a buffer's content from disk in-place, preserving the same buffer ID.
/// Called after the user confirms they want to accept an externally-made change.
/// The frontend should clear its `textEdited` flag and reload the CM view after this.
#[tauri::command]
fn reload_buffer(state: State<AppState>, buffer_id: u64) -> Result<FileInfo, String> {
    let path = {
        let buffers = state.registry.buffers.lock().unwrap();
        let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
        buf.path.clone().ok_or("Buffer has no path")?
    };

    let raw = std::fs::read(&path).map_err(|e| e.to_string())?;

    let encoding = {
        let buffers = state.registry.buffers.lock().unwrap();
        let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
        encoding_rs::Encoding::for_label(buf.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8)
    };

    let (rope, enc_name, line_ending) = file_io::decode_bytes(&raw, encoding);
    let mtime = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok());

    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.rope = rope;
    buf.encoding = enc_name;
    buf.line_ending = line_ending;
    buf.is_modified = false;
    buf.mtime = mtime;

    Ok(buf.file_info())
}

#[tauri::command]
fn rename_buffer(state: State<AppState>, buffer_id: u64, new_name: String) -> Result<FileInfo, String> {
    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.rename(&new_name).map_err(|e| e.to_string())?;
    Ok(buf.file_info())
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Text Access (virtual document)
// ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_lines(state: State<AppState>, buffer_id: u64, start_line: usize, count: usize) -> Result<LineChunk, String> {
    let buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
    Ok(buf.get_lines(start_line, count))
}

#[tauri::command]
fn get_full_text(state: State<AppState>, buffer_id: u64) -> Result<String, String> {
    let buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
    Ok(buf.get_full_text())
}

#[tauri::command]
fn apply_edit(state: State<AppState>, buffer_id: u64, op: EditOp) -> Result<FileInfo, String> {
    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.apply_edit(&op).map_err(|e| e.to_string())?;
    Ok(buf.file_info())
}

#[tauri::command]
fn get_buffer_info(state: State<AppState>, buffer_id: u64) -> Result<FileInfo, String> {
    let buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
    Ok(buf.file_info())
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Search & Replace
// ──────────────────────────────────────────────────────────────

#[tauri::command]
fn find_all(
    state: State<AppState>,
    buffer_id: u64,
    params: SearchParams,
    max_results: usize,
) -> Result<FindResult, String> {
    let max = if max_results == 0 { 10000 } else { max_results };
    search::find_all(&state.registry, buffer_id, &params, max).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_all(
    state: State<AppState>,
    buffer_id: u64,
    params: SearchParams,
    replacement: String,
) -> Result<usize, String> {
    search::replace_all(&state.registry, buffer_id, &params, &replacement).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_one(
    state: State<AppState>,
    buffer_id: u64,
    from: usize,
    to: usize,
    replacement: String,
) -> Result<(), String> {
    search::replace_one(&state.registry, buffer_id, from, to, &replacement).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Encoding & Line Endings
// ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_supported_encodings() -> Vec<String> {
    supported_encodings()
}

#[tauri::command]
fn change_encoding(state: State<AppState>, buffer_id: u64, encoding: String) -> Result<FileInfo, String> {
    file_io::change_encoding(&state.registry, buffer_id, &encoding).map_err(|e| e.to_string())?;
    let buffers = state.registry.buffers.lock().unwrap();
    Ok(buffers[&buffer_id].file_info())
}

/// Re-open the file associated with `buffer_id` using a different encoding.
/// Creates a new buffer so the editor reloads content from scratch.
/// Returns the new FileInfo (with a new buffer id); the old buffer is closed automatically.
#[tauri::command]
fn reopen_with_encoding(
    state: State<AppState>,
    buffer_id: u64,
    encoding: String,
) -> Result<FileInfo, String> {
    let path = {
        let buffers = state.registry.buffers.lock().unwrap();
        let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
        buf.path
            .clone()
            .ok_or("Cannot re-open an unsaved buffer with a different encoding")?
    };

    let new_id = file_io::open_file_with_encoding(&state.registry, &path, &encoding)
        .map_err(|e| e.to_string())?;

    // Remove the old buffer after the new one is ready
    state.registry.remove(buffer_id);

    let buffers = state.registry.buffers.lock().unwrap();
    Ok(buffers[&new_id].file_info())
}

#[tauri::command]
fn convert_line_endings(
    state: State<AppState>,
    buffer_id: u64,
    target: String,
) -> Result<FileInfo, String> {
    let le = match target.to_uppercase().as_str() {
        "CRLF" | "WINDOWS" => buffer::LineEnding::CrLf,
        _ => buffer::LineEnding::Lf,
    };
    let mut buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&buffer_id).ok_or("Buffer not found")?;
    buf.convert_line_endings(le);
    Ok(buf.file_info())
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Wordfile / Syntax
// ──────────────────────────────────────────────────────────────

#[tauri::command]
fn load_wordfiles(app: tauri::AppHandle) -> Vec<WordfileDef> {
    let mut all = Vec::new();

    // Built-in wordfiles from resource dir
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    all.extend(wordfile::load_wordfiles_from_dir(&resource_dir.join("wordfiles")));

    // User-imported wordfiles from app data dir
    if let Ok(data_dir) = app.path().app_data_dir() {
        all.extend(wordfile::load_wordfiles_from_dir(&data_dir.join("wordfiles")));
    }

    all
}

#[tauri::command]
fn parse_wordfile_content(content: String) -> WordfileDef {
    wordfile::parse_content(&content)
}

#[tauri::command]
fn import_wordfile_from_path(path: String) -> Result<WordfileDef, String> {
    let p = PathBuf::from(&path);
    wordfile::parse_wordfile(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_imported_wordfile(app: tauri::AppHandle, path: String) -> Result<WordfileDef, String> {
    let src = PathBuf::from(&path);

    // Parse first to validate
    let def = wordfile::parse_wordfile(&src).map_err(|e| e.to_string())?;

    // Persist to app data dir so it survives restarts
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let wordfiles_dir = data_dir.join("wordfiles");
    std::fs::create_dir_all(&wordfiles_dir).map_err(|e| e.to_string())?;

    let filename = src.file_name().ok_or("invalid filename")?;
    std::fs::copy(&src, wordfiles_dir.join(filename)).map_err(|e| e.to_string())?;

    Ok(def)
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Session / Scratch
// ──────────────────────────────────────────────────────────────

/// Export the full Rope of a buffer to a scratch file in app_data_dir/scratch/.
/// Returns the absolute path of the scratch file.
/// The caller must have already called syncEditorToRust on the frontend so that
/// any in-window CM edits are flushed into the Rope before this runs.
#[tauri::command]
fn export_buffer_to_scratch(
    app: tauri::AppHandle,
    state: State<AppState>,
    buffer_id: u64,
) -> Result<String, String> {
    let scratch_dir = session::scratch_dir(&app)?;
    let scratch_path = scratch_dir.join(format!("{}.txt", buffer_id));

    let buffers = state.registry.buffers.lock().unwrap();
    let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
    // Write rope as UTF-8; encoding/line_ending metadata is stored in session.json
    let text = buf.rope.to_string();
    std::fs::write(&scratch_path, text.as_bytes()).map_err(|e| e.to_string())?;

    Ok(scratch_path.to_string_lossy().to_string())
}

/// Read a scratch file, create a new buffer with its content, then delete the scratch.
/// If `original_path` is non-empty the buffer path is set to it (marking it as the
/// file the content belongs to, but `is_modified = true` so the user must save again).
#[tauri::command]
fn open_scratch_as_buffer(
    state: State<AppState>,
    scratch_path: String,
    original_path: String,
    encoding: String,
    line_ending: String,
) -> Result<FileInfo, String> {
    let scratch = std::path::PathBuf::from(&scratch_path);
    let content = std::fs::read_to_string(&scratch).map_err(|e| e.to_string())?;
    // Do NOT delete the scratch file here; cleanupScratchDir removes it after
    // all tabs are restored, preventing concurrent restore calls from racing.

    let rope = ropey::Rope::from_str(&content);
    let id = BufferRegistry::next_id();
    let path = if original_path.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(&original_path))
    };
    let le = match line_ending.to_uppercase().as_str() {
        "CRLF" | "WINDOWS" => buffer::LineEnding::CrLf,
        _ => buffer::LineEnding::Lf,
    };
    let enc = if encoding.is_empty() {
        "UTF-8".to_string()
    } else {
        encoding
    };

    let mut buf = buffer::Buffer::from_rope(id, rope, path, enc, le);
    buf.is_modified = true;
    state.registry.insert(buf);

    let buffers = state.registry.buffers.lock().unwrap();
    Ok(buffers[&id].file_info())
}

/// Persist the session to `app_data_dir/session.json`.
#[tauri::command]
fn save_session(app: tauri::AppHandle, session: session::AppSession) -> Result<(), String> {
    let path = session::session_path(&app)?;
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())
}

/// Load the session from `app_data_dir/session.json`. Returns `null` if none exists.
#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<Option<session::AppSession>, String> {
    let path = session::session_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let s: session::AppSession = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    Ok(Some(s))
}

/// Delete only the session JSON file. Does NOT touch scratch files – those
/// are either deleted one-by-one by `open_scratch_as_buffer` or cleaned up
/// after restore by `cleanup_scratch_dir`.
#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = session::session_path(&app)?;
    if session_path.exists() {
        std::fs::remove_file(&session_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Delete all files inside the scratch directory. Call this after all tabs
/// have been restored so any orphaned scratch files are cleaned up.
#[tauri::command]
fn cleanup_scratch_dir(app: tauri::AppHandle) -> Result<(), String> {
    let scratch = session::scratch_dir(&app)?;
    if !scratch.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&scratch).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    Ok(())
}

/// Called by the frontend after session has been saved; exits the process cleanly.
#[tauri::command]
fn confirm_close_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ──────────────────────────────────────────────────────────────
// Tauri Commands – Shell / Explorer Integration
// ──────────────────────────────────────────────────────────────

/// Returns "registered", "needs_update", or "not_registered".
#[tauri::command]
fn check_explorer_integration() -> Result<String, String> {
    shell_integration::check_integration()
}

/// Write (or overwrite) the Explorer right-click context menu entry.
#[tauri::command]
fn register_explorer_integration() -> Result<(), String> {
    shell_integration::register_integration()
}

/// Remove the Explorer right-click context menu entry.
#[tauri::command]
fn unregister_explorer_integration() -> Result<(), String> {
    shell_integration::unregister_integration()
}

/// Return the file path that was passed as a CLI argument (e.g. via Explorer
/// "Open with Power Editor").  Clears the stored value so subsequent calls
/// return `null` even within the same session.
#[tauri::command]
fn get_startup_file(state: State<AppState>) -> Option<String> {
    state.startup_file.lock().unwrap().take()
}

// ──────────────────────────────────────────────────────────────
// App entry point
// ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Capture a file path passed as a CLI argument (e.g. "power-editor.exe foo.txt").
    // Skip anything that looks like a flag or an internal Tauri/WebView argument.
    let startup_file = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a).exists());

    tauri::Builder::default()
        // Single-instance: when a second process is launched, forward its file
        // argument to the already-running instance and bring the window to focus.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.iter().skip(1).find(|a| {
                !a.starts_with('-') && std::path::Path::new(a.as_str()).exists()
            }) {
                let _ = app.emit("app:open-file", path.clone());
            }
            // Bring the existing window to the foreground
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let watcher = FileWatcherRegistry::new(app.handle().clone());
            let state = AppState {
                registry: Arc::new(BufferRegistry::new()),
                watcher: Arc::new(watcher),
                startup_file: std::sync::Mutex::new(startup_file),
            };
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent immediate close so the frontend can save the session first
                api.prevent_close();
                let _ = window.emit("app:close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            // File operations
            open_file,
            new_buffer,
            close_buffer,
            save_buffer,
            save_buffer_as,
            rename_buffer,
            reload_buffer,
            // Text access
            get_lines,
            get_full_text,
            apply_edit,
            get_buffer_info,
            // Search
            find_all,
            replace_all,
            replace_one,
            // Encoding
            get_supported_encodings,
            change_encoding,
            reopen_with_encoding,
            convert_line_endings,
            // Wordfile / Syntax
            load_wordfiles,
            parse_wordfile_content,
            import_wordfile_from_path,
            save_imported_wordfile,
            // Session / Scratch
            export_buffer_to_scratch,
            open_scratch_as_buffer,
            save_session,
            load_session,
            clear_session,
            cleanup_scratch_dir,
            confirm_close_app,
            // Shell / Explorer integration
            check_explorer_integration,
            register_explorer_integration,
            unregister_explorer_integration,
            get_startup_file,
            // CSV conversion
            csv::csv_detect,
            csv::csv_to_fixed_width,
            // Keybindings persistence
            keybindings::load_keybindings,
            keybindings::save_keybindings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

