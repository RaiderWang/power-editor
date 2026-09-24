# Power Editor

**[中文](README.zh-CN.md) | English**

> **A free, open-source, cross-platform text editor built for large files.** Open 100 MB, 1 GB, or even multi-gigabyte text files in seconds — no freezing, no crashing.

![Power Editor main window with syntax highlighting, multi-tab editing, and dark theme](docs/screenshots/power-editor.jpg)

---

## Why Power Editor?

Most text editors struggle — or outright crash — when you open a log file, CSV dump, or source archive that's hundreds of megabytes large. Power Editor was designed from scratch to handle exactly that, using a native Rust backend to stream and index content while the editor stays snappy.

**Who is it for?**

- Developers inspecting large build logs, server logs, or data exports
- Data engineers opening multi-hundred-MB CSV / TSV / JSON files
- System administrators editing large config files or grep output dumps
- Anyone who has ever seen "file too large" or a frozen editor

---

## Key Features

### ⚡ Open Files of Any Size — Instantly
Open 100 MB+ files in under a second. The editor streams content progressively, so you can start reading and editing immediately while the rest loads in the background. No waiting, no memory bloat.

### 🔍 Lightning-Fast Search Across the Entire File
Find and replace with full regex support, searching 100 MB of text in under 2 seconds. Results are listed with line numbers so you can jump straight to any match.

### 🎨 Syntax Highlighting
Compatible with **UltraEdit `.uew` Wordfile** format — a widely used syntax definition standard. Built-in support for C++, Python, and Rust. Import any `.uew` file at runtime via **Language → Import Wordfile** to add highlighting for your language immediately.

### 🌐 Multi-Encoding Support — Fix Garbled Text in One Click
Automatically detects file encoding on open (UTF-8, GBK, Big5, Shift_JIS, and dozens more). If a file looks garbled, click the encoding label in the status bar and reopen with the correct encoding instantly.

### ↕ Line Ending Conversion
Switch between LF (Unix) and CRLF (Windows) with a single click. Useful when sharing files across operating systems.

### ▦ Column / Block Selection (Alt + Drag)
Select a rectangular block of text across multiple lines — great for editing fixed-width data, log columns, or aligned code.

### 🗂 Multi-Tab Editing
Open and edit multiple files in parallel tabs. Right-click any tab for quick actions: Save As, Rename, Copy Path, Close Others.

### 🔔 External Change Detection
When another application modifies a file you have open, Power Editor notices immediately. If you have no unsaved changes, it silently reloads. If you do, it asks — reload or keep your edits.

### 🌙 Dark & Light Themes
Switch between dark and light modes from the View menu or toolbar.

### ⌨ Fully Customizable Keyboard Shortcuts
Open **File → Settings → Keyboard Shortcuts** to remap any action, detect conflicts, and reset to defaults. All customizations are saved across sessions.

### 📌 Favorites & Recent Files
Pin frequently used files to Favorites for one-click access. Recent Files tracks your full open history.

### 💾 Session Restore
Reopen Power Editor and your previous tabs reappear automatically, right where you left off.

---

## Download

Head to the [**Releases**](../../releases) page to download the latest installer for your platform:

| Platform | File |
|----------|------|
| Windows | `Power.Editor_x.y.z_x64-setup.exe` |
| macOS | `Power.Editor_x.y.z_universal.dmg` |
| Linux (x86_64 / ARM64) | `.deb` / `.AppImage` |

---

## Quick Start

1. **Install** the application for your OS (see Download above).
2. **Open a file**: drag-and-drop onto the window, use **File → Open**, or right-click a file in Windows Explorer → *Open with Power Editor*.
3. **Search**: press `Ctrl+F` for Find, `Ctrl+H` for Find & Replace.
4. **Switch encoding**: click the encoding label in the bottom status bar.
5. **Add syntax highlighting**: go to **Language → Import Wordfile (.uew)…** and select your `.uew` syntax file.

---

## Adding Syntax Highlighting

Power Editor uses the same **Wordfile** format as UltraEdit, so existing `.uew` files work out of the box.

**Option 1 — Runtime import (no restart needed):**
Go to **Language → Import Wordfile (.uew)…** and select your file. The language is available immediately.

**Option 2 — Bundle with the app (developer):**
Place `.uew` files in the `wordfiles/` directory and rebuild. They are packaged and loaded at startup.

Reference: [UltraEdit Wordfile format](https://www.ultraedit.com/wiki/Wordfiles)

---

## Known Issues

- **Windows Chinese punctuation (Chromium 149+):** A Chromium bug on Windows can cause Chinese IME punctuation to require two keystrokes. Power Editor has a built-in workaround applied automatically. The upstream browser fix is merged and will arrive with a future WebView2 update. See [docs/known-issues-chinese-ime-punctuation.md](docs/known-issues-chinese-ime-punctuation.md) for details.

---

## Building from Source

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run tauri:dev

# Production build
npm run tauri:build

# Linux / Kylin OS (Docker, ARM64 + x86_64)
./scripts/build-linux-docker.sh
```

> Linux and Kylin OS build instructions: [docs/build-linux-kylin.md](docs/build-linux-kylin.md)

---

## License

MIT
