# Changelog / 更新日志

All notable changes to this project will be documented in this file.
本项目的所有重要变更均记录于此文件。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added / 新增
- **External Deletion Prompt / 外部删除文件提示**:
  - When an open file is deleted or moved away by another program, a dialog now lets you either close the tab or save the content as a new file (previously nothing happened). Atomic-save editors (delete + recreate) are still treated as plain modifications.
    （**外部删除文件提示**：已打开的文件被外部程序删除或移走后，弹出对话框让用户选择“关闭标签”或“另存为新文件”（此前毫无提示）；原子写入型编辑器的“先删后建”仍按普通修改处理。）

### Fixed / 修复
- **File Watcher Follows Renames / 文件监听随重命名更新**:
  - Renaming a file from the tab bar or a file/folder from the explorer now updates the Rust-side buffer path and file watch; previously the explorer rename left `Buffer.path` stale, so Ctrl+S recreated the old file. "Save As" in place no longer drops its self-save record.
    （**重命名后同步更新路径与监听**：标签栏或资源管理器重命名文件/文件夹后，同步更新 Rust 端 buffer 路径与文件监听；此前资源管理器重命名不会更新 `Buffer.path`，导致 Ctrl+S 重新生成旧文件。原位“另存为”也不再丢失自保存记录。）
  - Deleting a file from the explorer now closes its tabs first (cancel aborts the deletion), avoiding stacked dialogs for tabs with unsaved changes.
    （**资源管理器删除先关标签**：先走标签关闭确认再删除磁盘文件，取消则不删除，避免有未保存修改的标签出现叠加弹窗。）
- **React 19 & Render Purity Cleanups / React 19 渲染副作用与状态规范修复**:
  - Eliminated ref mutations and DOM measurements during component render phases across `Editor`, `SearchPanel`, `VirtualScrollbar`, `MenuBar`, and `StatusBar` to strictly adhere to React 19 rules.
    （**组件渲染纯度与副作用规范化**：消除 `Editor`、`SearchPanel`、`VirtualScrollbar`、`MenuBar` 及 `StatusBar` 中在组件渲染阶段直接读写 Ref 或测量 DOM 偏移的副作用，严格遵循 React 19 规范。）
  - Prevented redundant virtual window reloads in `Editor` during Phase 2 background file loading by tracking total lines in a synchronized ref.
    （**避免大文件后台加载时冗余重载**：在 `Editor` 中通过 ref 跟踪行数，避免大文件 Phase 2 后台加载完成更新总行数时触发不必要的虚拟窗口重载。）
  - Streamlined special character expansion in `expandSpecialChars` using a single-pass regex replacement to eliminate sentinel character collisions.
    （**特殊字符转义算法优化**：`expandSpecialChars` 改用单趟正则替换，避免占位字符冲突与潜在的二次转义问题。）
- **Syntax Language Recognition on Save As / 另存为与新文件保存格式语法识别**:
  - Fixed an issue where saving a newly created (untitled) buffer or performing "Save As" did not trigger syntax highlighting for the target file extension (#4).
    （**新建文件另存为语法高亮即时生效**：修复新建未命名文件或执行“另存为”时，编辑器未能依据新文件扩展名即时识别语言格式并触发语法高亮的问题。）
  - Introduced the `getFileExtension` utility helper in `pathUtils.ts` to reliably parse extensions across platforms (correctly handling dotfiles such as `.gitignore`, extensionless files such as `Makefile`, and paths containing dots in directory segments).
    （**健壮的扩展名解析工具**：在 `pathUtils.ts` 引入 `getFileExtension` 工具函数，统一规范全应用（文件保存、重命名、文件树图标等）的文件扩展名解析，精准兼容如 `.gitignore` 隐藏文件、`Makefile` 无后缀文件及含有点号的文件夹路径等边缘场景。）

## [0.2.8] - 2026-10-21

### Added / 新增
- **Workspace Folder Tab Lifecycle & Safe Close Flow / 工作区文件夹标签联动与关闭确认安全拦截**:
  - **Associated Tab Lifecycle Management**: Closing a workspace folder (`closeFolder`) now automatically discovers all open tabs residing within that folder tree using normalized boundary path checking (`isPathInsideFolder`), cleanly stripping Windows extended-length prefixes (`\\?\`).
    （**工作区关联标签联动关闭**：执行“关闭文件夹”时，通过带边界隔离与 Windows 扩展长路径（`\\?\`）兼容的目录判定算法（`isPathInsideFolder`），智能识别并自动关闭属于该工程目录的所有打开标签页。）
  - **Asynchronous Safe Close & Cancellation Protection**: Upgraded `closeTab` to an asynchronous promise-based protocol. When tabs have unsaved edits, sequential folder closing prompts the user tab-by-tab (`CloseConfirmDialog`); if the user cancels saving any modified file, the folder closing sequence is aborted immediately to prevent accidental data loss.
    （**异步关闭协议与取消保护**：将 `closeTab` 改造为基于 Promise 的异步确认机制。包含未保存修改的标签页会依次唤起保存确认弹窗；若用户选择“取消”，将即时终止关闭文件夹流程，有效避免工作内容意外丢失。）
  - **Toolbar Action & Global Shortcut**: Added a dedicated "Close Folder" button with disabled state to the main toolbar (`FolderX` icon) and mapped a default keyboard shortcut (`Ctrl+Shift+W`), fully customizable in settings and reflected in the File menu and tooltips.
    （**工具栏快捷按钮与全局快捷键**：在主工具栏新增“关闭文件夹”快捷按钮（`FolderX` 图标，未打开文件夹时自动置灰），并绑定默认快捷键 `Ctrl+Shift+W`，支持偏好自定义与菜单栏双语提示同步。）
  - **State Store & Split-Pane Clean Fallback**: Fixed tab store state synchronization during sequential closures by updating active tab fallback for both primary and secondary split panes, while centralizing the Jotai default store binding at application root.
    （**状态同步与分屏安全回退**：重构标签页关闭底层的原子状态同步机制，同时适配主编辑区与分屏副编辑区的激活焦点安全回退，并在应用根节点规范化 Jotai 默认 Store 绑定。）
- **In-App Auto/Manual Updates / 应用内自动与手动更新**:
  - **Tauri v2 Updater Pipeline & Cryptographic Verification**: Integrated `tauri-plugin-updater` and `tauri-plugin-process` backed by Minisign/Ed25519 digital signature verification (`.sig`), fetching release manifests (`latest.json`) directly from GitHub Releases with passive background installation on Windows and in-place `.app` replacement on macOS.
    （**官方更新流水线与安全签名校验**：基于 `tauri-plugin-updater` 与 `tauri-plugin-process` 构建，集成 Minisign/Ed25519 密码学签名校验（`.sig`），直接对接 GitHub Releases 静态清单（`latest.json`），Windows 端支持静默被动安装，macOS 端进程内解压替换免除 Quarantine 隔离属性拦截。）
  - **Unsaved Session & Virtual Buffer Protection**: Engineered a pre-install session persistence guard (`persistAppSession`). Before executing update installation or restarting, Power Editor automatically flushes all CodeMirror virtual window modifications to Rust Rope buffers, exports modified documents to scratch files, and updates `session.json`, allowing `useSessionRestore` to seamlessly restore all open tabs, unsaved edits, and cursor positions upon relaunch.
    （**未保存缓冲与工作现场零丢失保护**：针对大文件虚拟窗口机制设计了更新前安全落盘逻辑（`persistAppSession`）。在执行更新安装与重启前，自动将 CodeMirror 视图的修改刷入 Rust Rope，将未保存标签页导出为 `scratch` 临时文件并更新 `session.json`，确保新版本重启后无缝恢复所有打开的文件、未保存内容及光标位置。）
  - **Non-Intrusive Status Bar Badge & Update Modal**: Checks silently 3 seconds after startup without interrupting editing. When a new version is detected, a green capsule badge (`⬆ vX.Y.Z`) appears unobtrusively on the status bar. Clicking the badge opens the dedicated `UpdateDialog`, displaying release notes parsed from `CHANGELOG.md`, a real-time progress bar (bytes / percentage), options to update immediately, skip this version, or download manually.
    （**状态栏非打扰式徽标与更新详情弹窗**：应用启动 3 秒后在后台静默检测，零弹窗干扰编辑；检测到新版本时在状态栏右侧呈现醒目的绿色胶囊徽标（`⬆ vX.Y.Z`）。点击即可唤起专属更新弹窗，展示当前版本的 Markdown 格式更新日志、实时下载字节与百分比进度条，支持“立即更新”、“跳过此版本”及网络受限时的“手动下载”兜底。）
  - **Entry Points & Preference Settings**: Added "Check for Updates..." to the `Help` menu and About dialog; added an "Automatically Check for Updates" toggle in `File -> Settings` submenu with preference persistence.
    （**全局入口与自动更新设置**：在 `帮助` 菜单与 `关于` 弹窗中提供“检查更新...”手动入口；在 `文件 -> 设置` 子菜单中提供“自动检查更新”开关，支持偏好记忆。）
  - **CI Release Manifest Automation**: Updated `.github/workflows/release.yml` and `.github/update_release_notes.py` to sign release artifacts and automatically inject the parsed version notes from `CHANGELOG.md` into `latest.json` on release publication.
    （**CI 自动化更新说明注入**：更新 `.github/workflows/release.yml` 与 `.github/update_release_notes.py`，在构建发布时自动执行密钥签名，并将 `CHANGELOG.md` 中提取的版本变更说明同步注入至 `latest.json` 的 `notes` 字段。）
- **WikiLink Image Embed Syntax Compatibility / WikiLink（双链）图片嵌入语法兼容**:
  - **Obsidian / WikiLink Image Rendering**: Added native preview and print support for WikiLink image embeds (`![[path/to/image.png]]`), parsing them into standard responsive `<img>` elements while leaving non-image embeds (notes, PDFs) untransformed.
    （**Obsidian / WikiLink 图片嵌入渲染**：Markdown 预览和打印模块原生支持双中括号图片语法（`![[path/to/image.png]]`），自动解析为标准自适应 `<img>` 元素，非图片资源链接（笔记、PDF 等）保持原样。）
  - **Dimension and Alt Text Attributes**: Full support for dimensions and captions such as `![[image.png|300]]` (width), `![[image.png|300x200]]` (width x height), `![[image.png|caption]]` (alt text), and combined `![[image.png|caption|width]]`.
    （**图片尺寸与描述支持**：全面支持如 `![[image.png|300]]`（单宽）、`![[image.png|300x200]]`（宽高）、`![[image.png|图片说明]]`（Alt 描述）以及组合参数 `![[image.png|说明|宽度]]`。）
  - **Smart Image Path Resolution & Obsidian Vault Root Support**: Cleanly normalizes Windows/POSIX relative paths and URL-encoded filenames. Supports both document-relative paths and Obsidian **vault-root-relative** paths (e.g. `![[Readwise/Tweets/attachments/...]]` by detecting `.obsidian` in ancestor folders), with a fast vault-wide index fallback for bare filenames and shortest-path links.
    （**智能路径解析与 Obsidian 库根目录相对路径兼容**：规范化 Windows/POSIX 相对路径与 URL 编码文件名。不仅支持当前文档同级相对路径，还原生支持 Obsidian **库根目录相对路径**（例如 `![[Readwise/Tweets/attachments/...]]`，通过自动向上探测父级 `.obsidian` 库标记识别根目录），并在全库范围内对单文件名或最短路径链接提供智能检索匹配。）


## [0.2.7] - 2026-10-14

### Added / 新增
- **Custom Editor Context Menu / 编辑器定制右键上下文菜单**:
  - **Native Context Menu Suppression**: Suppressed WebView2 default context menus (Back, Reload, Print, Inspect) across the application, while keeping native menus for text input elements (`<input>`, `<textarea>`) and enabling DevTools inspect via Shift+Right-Click in dev mode.
    （**原生右键菜单屏蔽**：全局拦截 WebView2 默认的浏览器右键上下文菜单（后退、刷新、打印等），同时保留文本输入框（`<input>`/`<textarea>`）的原生剪贴板功能，开发环境下支持按住 Shift 右键呼出检查元素。）
  - **Power Editor Native Ecosystem Context Menu**: Designed a dedicated, theme-aligned custom context menu for CodeMirror editor tabs featuring Undo/Redo, Cut/Copy/Paste, Select All (respecting large-file virtual document limits), Find & Replace, Delete Line, Case Transformations (UPPERCASE/lowercase), Word Wrap, Column Mode, Markdown Preview toggle, and Copy File Path.
    （**专属编辑器生态右键菜单**：专为 CodeMirror 设计契合 Power Editor 视觉风格的高性能右键菜单，提供撤销/重做、剪切/复制/粘贴、全选（兼容大文件虚拟加载限制）、查找替换、删除整行、大小写转换、自动换行与列模式切换、Markdown 预览切换及复制文件路径等功能。）
  - **System Clipboard Integration**: Clipboard read/write now goes through `tauri-plugin-clipboard-manager`; writing falls back to `navigator.clipboard` if the plugin fails. The menu and the Copy File Path shortcut share the same clipboard helper.
    （**系统剪贴板集成**：剪贴板读写改用 `tauri-plugin-clipboard-manager`，写入失败时回退到 `navigator.clipboard`；菜单与“复制文件路径”快捷键共用同一剪贴板工具。）
  - **Read-only tabs and split panes**: The menu also opens on read-only tabs (edit items disabled), and Uppercase/Lowercase act on the pane that was right-clicked.
    （**只读标签页与分屏**：只读标签页同样可弹出菜单（编辑类项目禁用）；转大写/小写作用于被右键点击的窗格。）
  - **Keyboard handling**: While the menu is open, Arrow keys / Enter / Esc are handled by the menu only and no longer also act on the editor; other keys close the menu.
    （**键盘处理**：菜单打开时，方向键/回车/Esc 仅由菜单处理，不再同时作用于编辑器；其他按键会关闭菜单。）

### Known limitations / 已知限制
- Pasting into multiple cursors or column selections inserts the full clipboard text at every selection.
  （多光标或列选区下粘贴时，每个选区都会插入完整的剪贴板文本。）

## [0.2.6] - 2026-10-13

### Improved / 优化
- **Markdown Code Block Appearance & High-Contrast Readability / Markdown 代码块视觉风格与可读性优化**:
  - **Border-Only Minimalist Styling / 极简透明线框风格**: Removed murky dark semi-transparent background in code blocks and inline code, switching to a clean border-only appearance (`border: 1px solid var(--code-border)`) that blends seamlessly with the editor canvas.
    （**极简无底色边框设计**：移除代码块及行内代码原有暗沉半透明底色，改为极简通透线框风格，与页面底色自然相融。）
  - **Dual-Theme Adaptive Syntax Highlighting / 双主题自适应高对比度语法高亮**: Adapted syntax token styling dynamically to Light and Dark modes. Light theme now uses high-contrast One Light / GitHub Light palettes (crisp dark slate punctuation, deep violet keywords, rich blue variables, amber types), resolving invisible punctuation and washed-out text on light backgrounds.
    （**双主题自适应高对比度语法配色**：代码高亮 token 全面适配浅色与深色主题。浅色模式下采用 One Light / GitHub Light 高对比度方案，标点符号使用深灰炭黑，关键字、类型名、变量色彩分明，彻底告别浅黄泛白与标点符号隐形问题。）
  - **Floating Action Bar (Language Badge & One-Click Copy) / 浮动工具栏（语言标签与一键复制代码）**: Added a pinned top-right floating toolbar on code blocks featuring a language pill badge (e.g. `ts`, `json`) and a one-click copy button with instant checkmark feedback and full i18n support.
    （**浮动工具栏（语言标签与一键复制代码）**：代码块右上角新增精致浮动工具栏，包含小巧语言角标及一键复制代码按钮，支持即时复制反馈与双语国际化提示。）


## [0.2.5] - 2026-10-13

### Added / 新增
- **VS Code-Style Open Folder & File Explorer Sidebar / VS Code 风格打开文件夹与侧边栏文件浏览面板**:
  - **Directory Tree & Lazy Loading**: Opens workspace folders via native directory picker (`Ctrl+Shift+O`), displaying file hierarchies with folders listed first and on-demand subfolder lazy loading (`list_directory`) to maintain instant responsiveness even for massive projects.
    （**目录树与按需懒加载**：支持通过原生系统对话框打开工程文件夹（`Ctrl+Shift+O`），文件夹置顶排列；子目录采用按需懒加载（Lazy Loading）架构，杜绝巨型工程一次性遍历卡顿。）
  - **Collapsible & Resizable Sidebar**: Left file explorer sidebar width is smoothly adjustable via mouse drag handle (160px–600px) with `localStorage` persistence; toggleable via toolbar button, View menu, or `Ctrl+B` shortcut.
    （**可折叠与自由调节侧边栏**：左侧文件面板支持鼠标自由拖拽调节宽度（160px ~ 600px）并自动持久化记忆；可通过工具栏按钮、视图菜单或 `Ctrl+B` 快捷键瞬间切换显隐。）
  - **Rich File Type Icons**: Differentiates entries with distinct visual icons for folders (open/closed) and common file extensions (Code, Markdown, JSON, CSV, Images, plain text).
    （**丰富的文件类型图标**：根据扩展名智能匹配专属视觉图标，支持文件夹（展开/折叠）、代码、Markdown、JSON、CSV、图片、普通文本等多种类型。）
  - **Tab Synchronization & One-Click Open**: Left-clicking a file opens it in editor tabs (or smoothly focuses the existing tab if already opened); switching the active editor tab automatically synchronizes tree selection.
    （**标签页深度联动与单击打开**：左键单击文件秒开标签页（若已打开则自动切换激活并避免重复打开）；切换激活标签页时目录树自动高亮定位对应文件。）
  - **Comprehensive Context Menu & File Operations**: Right-click context menu supporting Open File, New File, New Folder, Inline Renaming, Deletion (with safety confirmation dialog and open-tab closing), Copy Full Path, Copy Relative Path, and Reveal in Windows File Explorer.
    （**完整上下文右键菜单与文件管理**：右键菜单支持打开文件、新建文件、新建文件夹、内联重命名、删除（带二次防误删确认并联动关闭已打开标签）、复制完整路径、复制相对路径以及在系统文件资源管理器中定位。）
  - **Header Controls & UI Entry Points**: Features quick header action buttons (New File, New Folder, Refresh, Collapse All, Close Folder), Welcome Screen open button, File menu integration ("Open Folder...", "Close Folder"), and View menu integration.
    （**顶栏快捷操作与全局入口整合**：文件面板头部提供新建文件、新建文件夹、刷新、全部折叠、关闭文件夹等快捷操作；同步打通欢迎页、菜单栏（文件与视图）及工具栏入口。）
- **Binary File Detection & Read-Only Safety Protection / 非文本二进制文件智能拦截与只读安全保护**:
  - **Unified Single-Pass Stream Pipeline**: Merged binary heuristic detection into the primary streaming decode pipeline (`decode_stream_start`). The initial chunk sample detects both character encoding and binary characteristics in a single file open, eliminating redundant I/O and IPC round-trips for regular text files.
    （**单次 I/O 统一流式流水线**：将二进制启发式检测深度合并进主文件流式解码链路（`decode_stream_start`），在单次文件读取的同一内存样本上并行完成字符编码识别与二进制特征检测，普通文本文件秒开零冗余 I/O。）
  - **Heuristic Null-Byte & Control Character Check**: Employs SIMD `memchr` for instant null-byte (`0x00`) detection alongside control character ratio analysis, while respecting UTF-16 LE/BE and UTF-8 BOM markers to prevent false positives on wide-character text.
    （**空字节与控制字符启发式检测**：基于 SIMD `memchr` 极速探测空字节（`0x00`）及非打印控制字符比例；同时深度兼容 UTF-16 LE/BE 和 UTF-8 BOM，杜绝正常宽字符文本误报。）
  - **Deferred Confirmation & Resource Guard**: Intercepts binary files upon completion of Phase 1 chunk decoding without spawning heavy background loading tasks (Phase 2 continuation suppressed for binaries). Users can choose to open safely in read-only mode or cleanly discard the buffer without CPU/memory waste.
    （**资源保护与交互拦截**：在 Phase 1 首块读取后精准拦截二进制文件，彻底压制巨额后台流式解码（Phase 2），弹出确认框供用户选择“以只读模式打开”或“取消”；取消时立即释放 Rust 缓冲区，杜绝内存与 CPU 浪费。）
  - **Anti-Corruption Read-Only Lock**: When confirmed, the tab and CodeMirror editor enter read-only mode (`EditorState.readOnly` & `EditorView.editable`). Overwrite saves (`Ctrl+S`) are blocked both frontend and backend to protect binary assets (`.exe`, `.zip`, `.png`, etc.) from irreversible corruption, while permitting "Save As" to export content as new text files.
    （**防覆盖破坏只读锁定**：确认打开后，标签页与 CodeMirror 编辑器自动进入只读保护状态，前端与后端双重拦截原路覆盖保存（`Ctrl+S`），彻底杜绝破坏原文件；支持通过“另存为”将内容输出为新文件。）
  - **Visual Read-Only Badges**: Displays `[Read-Only]` / `[只读]` badges in the tab title and a dedicated 🔒 lock indicator with tooltips on the status bar.
    （**全方位只读状态指示**：在标签页标题后缀显示 `[只读]` 标识，并在底部状态栏常驻 🔒 只读图标与提示。）
- **Dedicated Markdown Formatting Toolbar / Markdown 专属格式化工具栏**:
  - **Contextual Auto-Display**: Automatically displays a compact dedicated formatting toolbar directly beneath the main toolbar when editing Markdown documents (`.md`, `.markdown`, etc.), and collapses completely for non-Markdown files without occupying vertical editing space.
    （**上下文感知自适应展示**：编辑 Markdown 文档（`.md`、`.markdown` 等）时，在主工具栏下方平滑展现专属格式化工具栏；切换至非 Markdown 代码或文本时自动收起，零占用编辑区垂直视野。）
  - **Comprehensive Markdown Actions**:
    - **Headings (H1–H4)**: Quick heading level switching and toggling on current/selected lines.
      （**各级标题 (H1–H4)**：对当前光标行或选中行快速设置、切换及取消标题。）
    - **Inline Styles**: Bold (`**`), Italic (`*`), Strikethrough (`~~`), and Inline Code (`` ` ``) with smart wrap/unwrap toggle and placeholder selection.
      （**行内样式**：粗体、斜体、删除线、行内代码，支持选区智能包裹、反向解包及未选中文本时的占位高亮。）
    - **Lists & Quotes**: Blockquote (`>`), Bullet List (`-`), Numbered List (`1.`), and Task List (`- [ ]`) with multi-line batch application.
      （**引用与列表**：引用块、无序列表、自动序号列表及待办勾选框，支持多行批量格式化。）
    - **Block Insertions**: Code Blocks (```` ``` ````), Link with auto-selected URL placeholder (`[title](url)`), standard 3x3 Table template, and Horizontal Rule (`---`).
      （**结构化插入**：多行代码块、带链接占位自动聚焦的超链接插入、3x3 标准表格模版及分割线。）
  - **Zero-Distraction & Focus Preservation**: Pinned non-intrusive layout preventing text occlusion; toolbar button clicks preserve CodeMirror 6 editor focus and selection seamlessly with full undo/redo history support.
    （**防遮挡与焦点保持**：顶栏固定布局彻底避免悬浮窗遮挡代码的问题；点击操作天然保持 CodeMirror 编辑器焦点与光标选区，完美支持 `Ctrl+Z` / `Ctrl+Y` 撤销重做。）

---

## [0.2.4] - 2026-10-12

### Added / 新增
- **Cross-Platform Document Printing (`Ctrl+P`) / 跨平台文档打印功能 (`Ctrl+P`)**:
  - **Rendered Markdown Printing**: Markdown documents print the fully formatted preview representation (GFM tables, blockquotes, syntax-highlighted code blocks, local images) instead of raw source code, without requiring the preview pane to be open.
    （**Markdown 渲染打印**：打印 Markdown 文件时直接输出渲染后的排版视图，包括 GFM 表格、引用块、带语法高亮的代码块及本地图片，无需预先开启预览面板。）
  - **Monospace Plain Text Printing with Line Numbers**: Non-markdown files (code, logs, text) print in clean, wrapped monospace format with an optional line numbers toggle in the File menu (with large file guard up to 10 MB).
    （**等宽纯文本打印与行号支持**：代码、日志、文本等非 Markdown 文件以整洁的等宽字体打印，支持在“文件”菜单中切换开启/关闭行号，并提供 10 MB 纯文本打印保护限制。）
  - **Printer-Friendly Styling**: High-contrast, ink-saving light typography (`@media print`) across all platforms (Windows, macOS, Linux) with page-break optimizations for tables, headers, and code blocks.
    （**环保高对比度打印样式**：跨平台（Windows / macOS / Linux）统一采用白底黑字省墨排版，自动优化标题分页、表格跨页表头重复及代码块分页行为。）
  - **Intelligent Selection Printing & Markdown Preview Text Selection / 智能选区打印与 Markdown 预览文本选择**:
    - Enabled native mouse text selection and copying inside the Markdown preview pane.
      （**启用 Markdown 预览文本选择**：恢复 Markdown 预览面板的内容划选与右键/快捷键复制能力。）
    - Added contextual selection printing: when text is selected in the source editor, printing outputs the raw monospace source text (with actual source file line numbering); when text is selected in the Markdown preview pane, printing directly outputs the formatted rich-text snippet (retaining tables, syntax highlighting, and local images). Without selection, prints the whole document as before.
      （**智能区分源码选区与预览选区打印**：在源码编辑区选中文本时，按打印仅输出选中的等宽源码文本（行号与原文件真实行号精准对齐）；在 Markdown 预览面板划选文本时，按打印输出所选的排版富文本片段（完整保留高亮代码块、表格与图片）。未选中文本时无缝回退至原有的全篇打印。）


---

## [0.2.3] - 2026-10-10

### Added / 新增
- **Built-in Markdown Syntax Highlighting & Wordfile Skipping / 内置 Markdown 语法高亮与 Wordfile 重复过滤**: Added built-in CodeMirror Markdown language highlighting support (`.md`, `.markdown`). Imported UltraEdit wordfiles (`.uew`) containing Markdown language definitions are automatically filtered with user notification to preserve native highlighting and preview capabilities.
  （增加内置 CodeMirror Markdown 语法高亮支持（`.md`、`.markdown`）。导入包含 Markdown 定义的 UltraEdit Wordfile 时自动过滤并弹出提示，优先使用原生语法高亮与预览。）
- **Real-time Markdown Preview Pane & Scroll Sync / 实时 Markdown 预览面板与同步滚动**: Added dual-pane Markdown preview (`Ctrl+Shift+V` / View menu / toolbar button) powered by `marked` and DOMPurify. Supports GFM tables, task lists, blockquotes, editor-to-preview line interpolation scroll sync, local image asset protocol rendering, safe external link opening, and fenced code block syntax highlighting. Files exceeding 5 MB or still background loading are guarded with friendly status indicators.
  （新增分屏 Markdown 实时预览功能（支持快捷键 `Ctrl+Shift+V`、视图菜单与工具栏按钮），基于 marked 与 DOMPurify 安全渲染。支持 GFM 表格、任务列表、引用块、编辑器至预览区行插值平滑同步滚动、本地相对路径图片通过 Tauri asset 协议安全显示、外部链接系统默认浏览器打开、以及代码块语法高亮。针对超过 5 MB 或后台加载中的大文件提供友好占位与状态指示。）

---

## [0.2.2] - 2026-10-08

### Fixed / 修复
- **Literal replacement in plain search mode / 普通替换模式保留字面量 `$` 字符**: Fixed an issue where "Replace All" in non-regex mode treated replacement text containing `$` or `${...}` (such as `${tag[i]}`) as regex capture group references, causing matches to be replaced with empty text. Plain text replacements are now inserted verbatim.
  （修复在非正则查找模式下点击「全部替换」时，替换内容中的 `$` 或 `${...}`（如 `${tag[i]}`）被当作正则表达式捕获组解析从而被替换为空的问题；普通替换现已严格按字面量文本插入。）

---

## [0.2.1] - 2026-10-08

### Added / 新增
- **Homebrew Cask distribution for macOS / macOS 支持 Homebrew Cask 安装**: Distribute macOS binaries via Homebrew Cask (`brew install --cask raiderwang/tap/power-editor`), including automatic Gatekeeper quarantine removal (`postflight`) to prevent "app is damaged" prompts.
  （支持通过 Homebrew Cask 安装 macOS 版本，内置 `postflight` 钩子自动清除隔离标记，彻底解决未签名应用“已损坏”提示。）
- **Automated Cask release sync / 自动同步更新 Homebrew Cask**: Added `update-cask` job in release workflow to calculate DMG SHA256 checksums and update `RaiderWang/homebrew-tap` upon release.
  （发版工作流新增 `update-cask` 任务，自动计算 DMG 哈希并更新 Homebrew Tap 仓库。）
- **Reopen with Encoding action & dialog / 以编码重新打开文件与快捷键支持**: Added "Reopen with Encoding..." to File menu, configurable keybinding (`file.reopenWithEncoding`), and centered modal fallback with Esc support.
  （文件菜单新增「以编码重新打开...」入口，支持自定义快捷键唤起，并优化编码选择面板支持居中显示及 Esc 快速关闭。）

### Changed / 变更与优化
- **Status bar encoding selector / 状态栏编码指示与交互升级**: Replaced plain text item with a dedicated button with visual dropdown cue (`Open as: {enc} ▾`), disabling interaction with tooltip for unsaved new files.
  （状态栏编码项升级为更具点击反馈的下拉按钮样式，针对未保存的新建文件提供禁用态及原因提示。）
- **Split view icon modernisation / 分屏按钮图标现代化**: Replaced text glyphs with clean Lucide icons in the tab bar.
  （标签栏分屏切换与关闭按钮采用 Lucide 矢量图标替代原有字符符号。）

---

## [0.2.0] - 2026-09-24

### Added / 新增
- **Two-phase large file loading / 两阶段大文件加载**: Read initial 4 MB chunk in Phase 1 for instant viewport rendering (<100 ms), followed by detached Phase 2 background streaming to append remaining content.
  （Phase 1 仅读取前 4MB 构建初始 Rope 实现首屏秒开渲染，Phase 2 在后台异步流式追加后续全部内容。）
- **Background load progress indicator / 后台加载非阻塞进度指示**: Non-blocking status bar indicator displaying percentage and loaded/total bytes during Phase 2 loading (`加载中… 13% (364 MB / 2.67 GB)`).
  （状态栏非阻塞显示加载百分比与已读/总大小，彻底移除阻断用户浏览的模态遮罩。）
- **Select-all crash prevention / 大文件全选崩溃拦截**: Intercept Select All (`Ctrl+A`) when files are larger than 50 MB or while Phase 2 background loading is in progress, preventing V8 memory exhaustion and UI crashes.
  （文件大于 50MB 或后台仍处于加载中时拦截全选操作并弹出提示，避免海量文本进入 JS 堆导致 V8 OOM 崩溃。）
- **Operation safety gates / 全链路操作安全门控**: Guard `save_buffer`, `save_buffer_as`, `find_all`, and `get_full_text` from executing before background loading completes.
  （在后台解析完成前显式拦截保存、另存、搜索以及全文提取操作，杜绝部分加载状态下的数据截断风险。）
- **Shared byte formatting utility / 共享字节格式化工具**: Extracted `formatBytes` utility supporting units up to GB.
  （提取独立的 `formatBytes` 共享工具函数，扩展支持至 GB 级显示。）

### Changed / 变更与优化
- **Official website link in About dialog / 更新关于窗口官方主页链接**: Changed website link in About dialog to `https://powereditor.noedge.org`.
  （将「关于 Power Editor」对话框中的链接更新为官网地址 `https://powereditor.noedge.org`。）
- **Streaming decode pipeline / 流式解码管线**: Replaced full-materialisation `fs::read` with `BufReader` + 4 MB streaming chunks, eliminating OOM crashes when opening 2 GB+ files.
  （从原先一次性整文件读取改为 `BufReader` + 4MB 分块流式处理，彻底解决 2GB+ 大文件崩溃与假死问题。）
- **CRLF normalisation / CRLF 规范化算法换代**: Replaced character-by-character scan with SIMD-accelerated `memchr` slice bulk copying, with an ultra-fast path for files without `\r`.
  （换行符规范化改为基于 SIMD 的 `memchr` 切片批量处理，针对纯 LF 文件提供零额外扫描开销的快速路径。）

### Fixed / 修复
- **Light theme welcome text / 浅色主题欢迎页文字不可见**: Fixed "Power Editor" title in welcome screen being hardcoded to white (`#ffffff`), now uses CSS variable `var(--app-fg)`.
  （修复欢迎页大标题硬编码为白色导致浅色主题下无法看清的问题，改用动态主题变量。）
- **Virtual scrollbar range on load completion / 虚拟滚动条量程刷新**: Synchronise total line count when `file:load-complete` event fires so the scrollbar thumb expands to the full file line count.
  （修复大文件后台加载完成后未同步更新总行数、导致滚动条量程停留在首屏几万行的缺陷。）

---

## [0.1.6] - 2026-09-21

### Added / 新增
- **Undo support for Replace All / 全部替换支持撤销**: Active window reloads with history tracking enabled (`trackHistory: true`), allowing `Ctrl+Z` to revert batch replacements.
  （全部替换后刷新当前窗口时保留历史变更记录，支持使用 `Ctrl+Z` 撤销全局替换操作。）

### Fixed / 修复
- **History reset on window jump / 窗口跳转时重置历史记录**: Properly reset CodeMirror undo/redo history when jumping to a new virtual document window, preventing stale undo entries from corrupting content.
  （在虚拟窗口跳转或滑动时彻底重置 CodeMirror 撤销栈，防止上一个窗口的历史记录破坏新窗口文本。）

---

## [0.1.5] - 2026-09-20

### Added / 新增
- **Automated release workflow / 自动化发布工作流**: Added GitHub Actions workflow (`.github/workflows/release.yml`) for multi-platform builds triggered by `v*` tag push or manual workflow dispatch.
  （新增 GitHub Actions 自动化发布流程，推送 `v*` 标签或手动触发时自动构建并发布各平台安装包。）

### Fixed / 修复
- **Preserve scroll position on buffer reload / 外部重载保持滚动位置**: Maintain scroll position and active line when reloading buffer from disk after external modification.
  （外部文件变更重新载入时，保持当前的滚动位置与光标行号不变。）

---

## [0.1.4] - 2026-08-27

### Added / 新增
- **Toolbar Undo and Redo buttons / 工具栏撤销与重做**: Added Undo and Redo action buttons to the main toolbar.
  （主工具栏增加「撤销」与「重做」快捷操作按钮。）
- **Linux & Kylin OS build docs / Linux 与银河麒麟编译指南**: Added build and packaging guide (`docs/build-linux-kylin.md`) using Docker for x86_64 and ARM64.
  （新增针对 Linux 和国产银河麒麟 Kylin OS 系统的 Docker 编译与打包文档。）

### Changed / 变更与优化
- **Virtual scrollbar dragging / 虚拟滚动条拖拽手感优化**: Switched to pointer-capture events for smooth, responsive scrollbar thumb dragging.
  （虚拟滚动条滑块改用 Pointer Capture 事件监听，大幅提升长距离拖拽时的响应与平滑度。）

### Fixed / 修复
- **Editor history on virtual jumps / 窗口跳转历史隔离**: Reset undo stack when switching virtual windows to prevent cross-window undo corruption.
  （虚拟窗口按需切换时及时清理撤销记录，避免跨窗口产生脏撤销。）
- **IME shortcut conflicts / 解决输入法与快捷键冲突**: Skip shortcut handling during IME composition to avoid unexpected key interception.
  （在输入法输入处于合成（composition）阶段时跳过快捷键派发，避免中文输入法与全局快捷键冲突。）

---

## [0.1.3] - 2026-08-04

### Added / 新增
- **Copy File Name option / 标签页右键复制文件名**: Added "Copy File Name" to the tab context menu alongside "Copy File Path".
  （标签页右键菜单新增「复制文件名」选项，便于快速提取文件名。）
- **README screenshots / 补充界面截图**: Added refreshed screenshots to both English and Chinese README documentation.
  （在英文与中文 README 文档中补充最新的应用程序主界面截图。）

### Changed / 变更与优化
- **Extended Wordfile syntax support / 增强 Wordfile 语法支持**: Extended `.uew` parser to support alternate line comments (`/Alt Line Comment =`), escape characters (`/Escape Char =`), and `Noquote` string parsing.
  （增强 UltraEdit Wordfile 解析器，支持备用行注释、转义字符以及 Noquote 特性。）

---

## [0.1.2] - 2026-07-27

### Added / 新增
- **External file modification detection / 外部文件变动监听**: Integrated `notify` watcher to detect disk changes — silently reloads clean buffers, or prompts with confirmation when local unsaved changes exist.
  （集成 `notify` 监听外部文件变动：无本地修改时静默重载，有未保存修改时弹出确认对话框。）
- **Line number gutter synchronization / 行号栏真实行号对齐**: Synchronised virtual window offset with line-number gutter so real file line numbers are displayed.
  （CodeMirror 行号栏与滑动窗口偏移同步，始终显示文件真实行号而非局部窗口行号。）
- **Customizable keyboard shortcuts / 自定义快捷键**: Added shortcuts settings dialog with conflict detection, search, and app-data persistence.
  （新增快捷键设置对话框，支持快捷键自定义、冲突检测、按类搜索与持久化保存。）

### Changed / 变更与优化
- **Default UI locale / 默认界面语言调整**: Set default UI locale to English (`en-US`), with Chinese (`zh-CN`) selectable via settings.
  （将默认界面语言设为英文 `en-US`，中文可通过菜单或设置自由切换。）

---

## [0.1.1] - 2026-07-17

### Fixed / 修复
- **Viewport stability after Replace All / 替换后视口稳定**: Prevented viewport jumping after batch Replace All operations.
  （修复全部替换后视口意外滚动跳动的问题。）
- **Gutter text selection / 禁用行号栏文本选择**: Prevented text selection in gutter and line numbers.
  （行号栏与侧边间隙区域禁用文本选择，避免拖拽复制时误选行号。）
- **Search highlight alignment / 搜索高亮与虚拟窗口对齐**: Aligned search highlight coordinate mapping with sliding virtual window boundaries.
  （修正滑动窗口下搜索高亮区域的字节偏移映射，保证高亮位置准确。）

---

## [0.1.0] - 2026-07-15

### Added / 新增
- **Initial release of Power Editor / Power Editor 首次发布**: High-performance text editor built with Tauri v2, React 19, and CodeMirror 6.
  （基于 Tauri v2 + React 19 + CodeMirror 6 的高性能跨平台大文件文本编辑器。）
- **Rust Rope text buffer / Rust Rope 树形文本缓冲**: Backed by `ropey` for fast $O(\log n)$ edits and virtual document chunking on 100MB+ files.
  （基于 Ropey 实现 $O(\log n)$ 编辑开销与分块虚拟加载，轻松驾驭 100MB+ 大文本。）
- **UltraEdit Wordfile syntax highlighting / 兼容 UltraEdit 语法高亮**: Compatible with `.uew` Wordfile format, with bundled C++, Python, and Rust syntax.
  （兼容 UltraEdit `.uew` 语法高亮体系，内置 C++、Python、Rust 语法高亮文件并支持动态导入。）
- **SIMD regex search engine / SIMD 加速正则搜索**: High-speed full-text search and replace via Rust `regex`.
  （基于 Rust SIMD 优化的正则查找与替换引擎，100MB 全文搜索秒级响应。）
- **Multi-encoding support / 多编码探测与转换**: Auto-detection and seamless switching for UTF-8, UTF-16, GBK, Big5, Shift_JIS, etc.
  （多编码自动识别与转换，支持以指定编码原地重新打开文件修复乱码。）
- **Line ending conversion / 换行符转换**: Detection and conversion between LF and CRLF.
  （行结束符自动识别与 LF ↔ CRLF 批量转换。）
- **Column mode editing / 列模式编辑**: Rectangular selection and multi-cursor editing via Alt + drag.
  （支持 Alt + 鼠标拖选的矩形列模式编辑。）
- **Multi-tab & split views / 多标签页与分屏**: Multi-tab management, horizontal/vertical split-pane layouts, and dark/light themes.
  （多标签页编辑、水平/垂直双栏分屏视图、深色与浅色主题实时切换。）
- **Windows Explorer integration / Windows 资源管理器集成**: Optional context menu registration ("Open with Power Editor").
  （支持一键集成到 Windows 资源管理器右键菜单。）

---

[Unreleased]: https://github.com/RaiderWang/power-editor/compare/v0.2.8...HEAD
[0.2.8]: https://github.com/RaiderWang/power-editor/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/RaiderWang/power-editor/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/RaiderWang/power-editor/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/RaiderWang/power-editor/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/RaiderWang/power-editor/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/RaiderWang/power-editor/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/RaiderWang/power-editor/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/RaiderWang/power-editor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/RaiderWang/power-editor/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/RaiderWang/power-editor/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/RaiderWang/power-editor/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/RaiderWang/power-editor/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/RaiderWang/power-editor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RaiderWang/power-editor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RaiderWang/power-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RaiderWang/power-editor/releases/tag/v0.1.0
