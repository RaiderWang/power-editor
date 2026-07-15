/// Windows Explorer right-click context menu integration.
///
/// Writes to HKCU\Software\Classes\*\shell\PowerEditor so that all file types
/// show "用 Power Editor 打开" in the Explorer context menu.  Using HKCU means
/// no administrator privilege is required.
///
/// Non-Windows: stub functions return "not_registered" / Err for unsupported.

// ── Registry key paths (Windows only) ────────────────────────────────────────

#[cfg(windows)]
const SHELL_KEY: &str = r"Software\Classes\*\shell\PowerEditor";

#[cfg(windows)]
const CMD_KEY: &str = r"Software\Classes\*\shell\PowerEditor\command";

// ── Public API ────────────────────────────────────────────────────────────────

/// Returns one of:
/// - `"registered"`   – already registered with the current exe path
/// - `"needs_update"` – registered but pointing to a different exe
/// - `"not_registered"` – no registry entry found
#[cfg(windows)]
pub fn check_integration() -> Result<String, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey(CMD_KEY) {
        Ok(key) => {
            let registered_cmd: String = key.get_value("").map_err(|e| e.to_string())?;
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let expected = build_command(&exe_path.to_string_lossy());
            if registered_cmd == expected {
                Ok("registered".to_string())
            } else {
                Ok("needs_update".to_string())
            }
        }
        Err(_) => Ok("not_registered".to_string()),
    }
}

#[cfg(not(windows))]
pub fn check_integration() -> Result<String, String> {
    Ok("not_registered".to_string())
}

/// Write (or overwrite) the registry entries so Explorer shows "用 Power Editor 打开".
#[cfg(windows)]
pub fn register_integration() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().to_string();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // Shell entry – display name and icon
    let (shell_key, _) = hkcu.create_subkey(SHELL_KEY).map_err(|e| e.to_string())?;
    shell_key
        .set_value("", &"用 Power Editor 打开")
        .map_err(|e| e.to_string())?;
    shell_key
        .set_value("Icon", &format!("{},0", exe_str))
        .map_err(|e| e.to_string())?;

    // Command entry – the actual invocation
    let (cmd_key, _) = hkcu.create_subkey(CMD_KEY).map_err(|e| e.to_string())?;
    cmd_key
        .set_value("", &build_command(&exe_str))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(windows))]
pub fn register_integration() -> Result<(), String> {
    Err("此平台不支持资源管理器集成".to_string())
}

/// Remove all registry entries created by `register_integration`.
#[cfg(windows)]
pub fn unregister_integration() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.delete_subkey_all(SHELL_KEY)
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn unregister_integration() -> Result<(), String> {
    Err("此平台不支持资源管理器集成".to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build the registry command string: `"<exe>" "%1"`
#[cfg(windows)]
fn build_command(exe: &str) -> String {
    format!(r#""{}" "%1""#, exe)
}
