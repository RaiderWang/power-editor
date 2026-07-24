use std::path::PathBuf;
use tauri::Manager;

fn keybindings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("keybindings.json"))
}

#[tauri::command]
pub fn load_keybindings(app: tauri::AppHandle) -> Result<String, String> {
    let path = keybindings_path(&app)?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_keybindings(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let path = keybindings_path(&app)?;
    std::fs::write(&path, data.as_bytes()).map_err(|e| e.to_string())
}
