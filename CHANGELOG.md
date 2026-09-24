# Changelog / 更新日志

All notable changes to this project will be documented in this file.
本项目的所有重要变更均记录于此文件。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] / [未发布]

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

[Unreleased]: https://github.com/RaiderWang/power-editor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/RaiderWang/power-editor/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/RaiderWang/power-editor/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/RaiderWang/power-editor/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/RaiderWang/power-editor/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/RaiderWang/power-editor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RaiderWang/power-editor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RaiderWang/power-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RaiderWang/power-editor/releases/tag/v0.1.0
