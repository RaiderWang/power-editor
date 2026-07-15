# Power Editor

**中文 | [English](README.md)**

高性能跨平台文本编辑器，针对 100MB+ 大文件优化，兼容 UltraEdit Wordfile 语法高亮。

## 技术栈

| 层级 | 技术 |
|------|------|
| 应用框架 | Tauri 2.0 |
| 前端 | React 18 + TypeScript + Vite 8 |
| 编辑器渲染 | CodeMirror 6 |
| 文本缓冲 | Rust + ropey (B-tree Rope) |
| 文件 I/O | Rust memmap2 + tokio + notify（外部修改监听） |
| 编码处理 | encoding_rs + chardetng |
| 搜索引擎 | Rust regex (SIMD 加速) |
| 状态管理 | Jotai |

## 主要功能

- **大文件支持**：通过 Rust Rope 缓冲区 + 虚拟渲染，快速打开 100MB+ 文件
- **语法高亮**：兼容 UltraEdit `.uew` Wordfile 格式，内置 C++、Python、Rust 高亮
- **查找替换**：Rust SIMD regex 引擎，全文搜索 100MB 文件 < 2s
- **编码转换**：自动检测编码，支持 UTF-8/GBK/Big5/Shift_JIS 等主流编码；状态栏点击编码可弹出列表，以指定编码重新打开当前文件（解决乱码）
- **换行符转换**：LF ↔ CRLF 互转
- **列模式编辑**：Alt + 拖动矩形选区
- **多标签页**：同时编辑多个文件；最右侧标签旁提供 **+** 按钮快速新建空白标签（等同工具栏「新建」）；标签栏右键菜单（另存为、重命名、复制文件路径、关闭所有/其它标签）
- **外部文件修改检测**：已打开文件被外部程序修改时自动感知；无未保存更改则静默从磁盘重载，有本地编辑则弹出确认框（重新加载 / 保留本地更改）
- **深色/浅色主题**切换
- **菜单栏**：文件（新建/打开/**收藏**/**收藏的文件**/最近打开/保存/**另存为**/关闭标签/**设置**）、编辑（查找替换、**删除行**、**重命名**、复制文件路径）、视图（自动换行、列模式、字号、**编辑器字体**、主题切换）、格式（编码与换行符）、语言（语法列表与 **导入 Wordfile**）；功能与工具栏互补，工具栏仍保留编码与语言等快捷控件
- **自定义快捷键**：**文件 → 设置 → 快捷键设置...** 打开快捷键面板，按分类列出菜单、工具栏及编辑器内置快捷键；可点击修改可编辑项、检测冲突、恢复单项或全部默认，自定义配置持久化到 localStorage（macOS 下 `Cmd` 等同于 `Ctrl`）

## 已知问题

- **Windows 中文标点需按两次（已应用临时补丁）**：Chromium 149+ 在 Windows 上会将 CodeMirror 默认的 `autocorrect="off"` 误判为自动纠错并静默撤销 IME 瞬时插入（中文标点等），导致每隔一次按键才出现字符。Power Editor 已在 Windows + Chromium 149+ 环境下通过 `EditorView.contentAttributes` 强制 `autocorrect="on"` 绕过该回归（见 `src/extensions/chromiumImeAutocorrectWorkaround.ts`）；桌面端几乎无自动拼写纠错副作用。上游修复已合并（[Chromium Issue 521205128](https://issues.chromium.org/issues/521205128)、[CL 7917332](https://chromium-review.googlesource.com/c/chromium/src/+/7917332)），待用户 WebView2 普遍升级至含修复版本（预计 149.0.7827.103 修订版或 150+）后可移除此补丁。详见 [docs/known-issues-chinese-ime-punctuation.md](docs/known-issues-chinese-ime-punctuation.md)。

## 开发

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run tauri:dev

# 生产构建
npm run tauri:build
```

## 添加自定义语法高亮

有两种方式：

1. **内置目录**：将 UltraEdit 格式的 `.uew` 文件放入项目根目录 `wordfiles/`，随应用打包后在启动时加载。
2. **运行时导入**：使用菜单 **语言 → 导入 Wordfile (.uew)...** 选择任意 `.uew` 文件，解析结果会合并进当前会话的语言列表（同名语言会被覆盖）。

Wordfile 格式参考：https://www.ultraedit.com/wiki/Wordfiles

## 项目结构

```
power-editor/
├── src/                        # React 前端
│   ├── assets/                 # 静态资源（图标、图片）
│   ├── components/
│   │   ├── dialogs/            # AboutDialog、CloseConfirmDialog、CsvToFixedWidthDialog、
│   │   │                       #   ExternalChangeDialog、KeyboardShortcutsDialog、RenameDialog
│   │   ├── editor/             # Editor.tsx（CM6 视图）、SearchPanel、LineListDialog、
│   │   │                       #   HistoryComboInput、VirtualScrollbar
│   │   ├── layout/             # EditorPane 布局容器
│   │   ├── menubar/            # MenuBar + FontPickerModal
│   │   ├── statusbar/          # StatusBar + EncodingPicker
│   │   ├── tabs/               # TabBar + TabContextMenu
│   │   └── toolbar/            # 工具栏（编码/语言等快捷控件）
│   ├── extensions/             # CM6 扩展：columnMode、searchHighlight、
│   │                           #   wordfileSyntax、smartEnter、chromiumImeWorkaround
│   ├── hooks/                  # useFile、useFileWatcher、useKeybindingDispatcher、
│   │                           #   useSessionRestore、useWindowClose、usePrefsPersist
│   ├── i18n/                   # useTranslation Hook + 语言包
│   │   └── locales/            # en-US.json、zh-CN.json
│   ├── store/                  # Jotai atoms、editorViewRegistry、keybindings、
│   │                           #   tauriCommands、recentFiles、favoriteFiles、searchHistory
│   ├── types/                  # TypeScript 类型定义（与 Rust 结构体对应）
│   └── utils/                  # pathUtils、tabFileName、specialChars
├── src-tauri/                  # Rust 后端
│   └── src/
│       ├── buffer/             # Rope 文本缓冲 + 虚拟文档 API
│       ├── csv/                # CSV 转固定宽度文本
│       ├── file_io/            # 文件 I/O、编码检测/转换
│       ├── file_watcher/       # 磁盘文件变更监听（notify）
│       ├── search/             # SIMD 查找替换引擎
│       ├── session/            # 会话持久化（应用重启后恢复标签）
│       ├── shell_integration/  # Windows 资源管理器右键菜单注册
│       └── wordfile/           # UltraEdit .uew 解析器
├── docs/                       # 文档（已知问题等）
└── wordfiles/                  # 内置语法定义（C++、Python、Rust）
```

## 自定义程序图标

用 Tauri CLI 自动生成所有尺寸：

```bash
npm run tauri icon app-icon.png
```
