use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    pub readonly: bool,
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let read_dir = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let file_type = entry.file_type().ok();
        let is_symlink = file_type.map(|ft| ft.is_symlink()).unwrap_or(false);
        let is_dir = metadata.is_dir();
        let size = if is_dir { None } else { Some(metadata.len()) };
        let readonly = metadata.permissions().readonly();

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            size,
            readonly,
        });
    }

    // Sort: directories first, then alphabetical case-insensitive
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("A file or folder with that name already exists".to_string());
    }
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::File::create(&p).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("A folder with that name already exists".to_string());
    }
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_path(
    state: tauri::State<crate::AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old_p = PathBuf::from(&old_path);
    let new_p = PathBuf::from(&new_path);
    if !old_p.exists() {
        return Err("The file or folder does not exist".to_string());
    }
    if new_p.exists() {
        return Err("A file or folder with that name already exists".to_string());
    }
    fs::rename(&old_p, &new_p).map_err(|e| e.to_string())?;
    // Keep open buffers (a renamed file, or files inside a renamed folder) in
    // sync: update `Buffer.path` so saving writes to the new location, and move
    // the watches so the old path is not reported as "externally deleted".
    for (buffer_id, path) in state.registry.relocate_paths(&old_p, &new_p) {
        state.watcher.rewatch_buffer(buffer_id, path);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("The file or folder does not exist".to_string());
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Target path does not exist".to_string());
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        use std::process::Command;
        let parent = p.parent().unwrap_or(&p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
