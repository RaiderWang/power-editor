use tauri::WebviewWindow;

/// Triggers printing on the given webview window.
/// On macOS, wry / Tauri provides dedicated native WKWebView printing via `window.print()`.
/// On other platforms (Windows WebView2, Linux WebKitGTK), `window.print()` in JS is standard.
#[tauri::command]
pub async fn print_window(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window.print().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}
