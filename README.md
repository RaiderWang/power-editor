# Power Editor

**[中文](README.zh-CN.md) | English**

High-performance cross-platform text editor optimized for 100MB+ large files, with UltraEdit Wordfile syntax highlighting support.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App Framework | Tauri 2.0 |
| Frontend | React 18 + TypeScript + Vite 8 |
| Editor Renderer | CodeMirror 6 |
| Text Buffer | Rust + ropey (B-tree Rope) |
| File I/O | Rust memmap2 + tokio + notify (external change watching) |
| Encoding | encoding_rs + chardetng |
| Search Engine | Rust regex (SIMD-accelerated) |
| State Management | Jotai |

## Features

- **Large File Support**: Open 100MB+ files instantly via Rust Rope buffer + virtual rendering
- **Syntax Highlighting**: Compatible with UltraEdit `.uew` Wordfile format; built-in C++, Python, and Rust highlighting
- **Find & Replace**: Rust SIMD regex engine — full-text search across a 100MB file in under 2 seconds
- **Encoding Conversion**: Auto-detects encoding; supports UTF-8, GBK, Big5, Shift_JIS, and more. Click the encoding indicator in the status bar to reopen the file with a different encoding (fixes garbled text)
- **Line Ending Conversion**: LF ↔ CRLF conversion
- **Column Mode Editing**: Alt + drag for rectangular selections
- **Multi-Tab**: Edit multiple files simultaneously; a **+** button next to the rightmost tab creates a new blank tab (same as toolbar "New"); tab bar context menu (Save As, Rename, Copy Path, Close All / Close Others)
- **External File Change Detection**: Automatically detects when an open file is modified by another program — silently reloads if there are no unsaved changes, or prompts (Reload / Keep Local Changes) if local edits exist
- **Dark / Light Theme** toggle
- **Menu Bar**: File (New / Open / **Favorites** / **Favorited Files** / Recent / Save / **Save As** / Close Tab / **Settings**), Edit (Find & Replace / **Delete Line** / **Rename** / Copy Path), View (Word Wrap / Column Mode / Font Size / **Editor Font** / Theme), Format (Encoding & Line Endings), Language (Syntax List & **Import Wordfile**)
- **Custom Keybindings**: Open via File → Settings → Keyboard Shortcuts… — browse by category, click to remap editable actions, detect conflicts, reset individual or all defaults; persisted to localStorage (macOS `Cmd` equals `Ctrl`)

## Known Issues

- **Windows Chinese punctuation requires two keystrokes (temporary patch applied)**: Chromium 149+ on Windows misinterprets CodeMirror's default `autocorrect="off"` as spell-correction and silently reverts IME transient insertions (Chinese punctuation, etc.), causing every other keystroke to be dropped. Power Editor works around this on Windows + Chromium 149+ by forcing `autocorrect="on"` via `EditorView.contentAttributes` (see `src/extensions/chromiumImeAutocorrectWorkaround.ts`); there is virtually no autocorrect side-effect on the desktop. The upstream fix has been merged ([Chromium Issue 521205128](https://issues.chromium.org/issues/521205128), [CL 7917332](https://chromium-review.googlesource.com/c/chromium/src/+/7917332)); the workaround can be removed once WebView2 is broadly updated to the fixed version (expected in 149.0.7827.103 patch or 150+). See [docs/known-issues-chinese-ime-punctuation.md](docs/known-issues-chinese-ime-punctuation.md).

## Development

```bash
# Install dependencies
npm install

# Dev mode (hot reload)
npm run tauri:dev

# Production build
npm run tauri:build
```

## Custom Syntax Highlighting

Two ways to add your own syntax:

1. **Bundled directory**: Place UltraEdit-format `.uew` files in the `wordfiles/` directory at the project root. They are packaged with the app and loaded at startup.
2. **Runtime import**: Use the menu **Language → Import Wordfile (.uew)…** to select any `.uew` file. The parsed definition is merged into the current session's language list (same-name language is overwritten).

Wordfile format reference: https://www.ultraedit.com/wiki/Wordfiles

## Project Structure

```
power-editor/
├── src/                        # React frontend
│   ├── assets/                 # Static assets (icons, images)
│   ├── components/
│   │   ├── dialogs/            # AboutDialog, CloseConfirmDialog, CsvToFixedWidthDialog,
│   │   │                       #   ExternalChangeDialog, KeyboardShortcutsDialog, RenameDialog
│   │   ├── editor/             # Editor.tsx (CM6 view), SearchPanel, LineListDialog,
│   │   │                       #   HistoryComboInput, VirtualScrollbar
│   │   ├── layout/             # EditorPane layout wrapper
│   │   ├── menubar/            # MenuBar + FontPickerModal
│   │   ├── statusbar/          # StatusBar + EncodingPicker
│   │   ├── tabs/               # TabBar + TabContextMenu
│   │   └── toolbar/            # Toolbar (encoding / language quick controls)
│   ├── extensions/             # CM6 extensions: columnMode, searchHighlight,
│   │                           #   wordfileSyntax, smartEnter, chromiumImeWorkaround
│   ├── hooks/                  # useFile, useFileWatcher, useKeybindingDispatcher,
│   │                           #   useSessionRestore, useWindowClose, usePrefsPersist
│   ├── i18n/                   # useTranslation hook + locale files
│   │   └── locales/            # en-US.json, zh-CN.json
│   ├── store/                  # Jotai atoms, editorViewRegistry, keybindings,
│   │                           #   tauriCommands, recentFiles, favoriteFiles, searchHistory
│   ├── types/                  # TypeScript type definitions (mirror Rust structs)
│   └── utils/                  # pathUtils, tabFileName, specialChars
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── buffer/             # Rope text buffer + virtual document API
│       ├── csv/                # CSV-to-fixed-width conversion
│       ├── file_io/            # File I/O, encoding detection / conversion
│       ├── file_watcher/       # Disk file change watcher (notify)
│       ├── search/             # SIMD find & replace engine
│       ├── session/            # Session persistence (tab restore on app restart)
│       ├── shell_integration/  # Windows Explorer context menu registration
│       └── wordfile/           # UltraEdit .uew parser
├── docs/                       # Documentation (known issues, etc.)
└── wordfiles/                  # Bundled syntax definitions (C++, Python, Rust)
```

## Custom App Icon

Generate all icon sizes automatically via the Tauri CLI:

```bash
npm run tauri icon app-icon.png
```
