# 已知问题：中文标点需按两次才能输入

> **状态**：上游 Chromium 回归；**应用层临时补丁已启用**（待 WebView2 含修复版本普及后移除）  
> **最后更新**：2026-06-16  
> **与本项目关系**：非 Power Editor 业务代码缺陷

## 现象

在 Windows 上使用中文输入法（如微软拼音）时，在编辑器内输入中文标点（如 `。`、`，`、`；`）需要按 **两次** 才出现 **一次** 字符；中文汉字（拼音选字）输入正常。

典型模式：第 1 次无输出 → 第 2 次出现 → 第 3 次无输出 → 第 4 次出现……

## 结论（根因）

Chromium 149+ 在 Windows 的 TSFTextStore 中，当 `contenteditable` 带有 **`autocorrect="off"`**（CodeMirror 6 默认值）时，会错误地将 IME 的「瞬时非合成插入」（中文标点、日文全角空格等）判定为自动纠错并静默 Revert，导致每隔一次按键被吞掉。这是 **Chromium 引擎 bug**，不是 Power Editor 业务逻辑导致。

依据：

1. CodeMirror 维护者 marijn 在 Chrome 149 稳定版上复现，并提交了 Chromium issue。
2. 用极简 `contenteditable` 即可复现，无需 CodeMirror 或本项目任何扩展。
3. 官方 [Try CodeMirror](https://codemirror.net/try/) 在受影响环境下同样复现。
4. 本机 Tauri 使用 **Microsoft Edge WebView2 Runtime** 渲染，底层为 Chromium；当前开发机版本为 **149.0.4022.62**，与已知回归版本一致。

## 为何汉字正常、标点异常

| 输入类型 | IME 行为 | 结果 |
|----------|----------|------|
| 汉字（拼音选字） | 完整合成：`compositionstart` → 多次 `compositionupdate` → 选字 → `compositionend` | 通常正常 |
| 中文标点 | **瞬时合成**：`compositionstart` 与 `compositionend` 几乎同时，无候选窗口 | 易受 Chromium bug 影响，每隔一次按键被吞掉 |

## 受影响环境

- **操作系统**：Windows 10 / 11
- **渲染引擎**：Chromium 系（Chrome、Edge、**Tauri WebView2**）
- **输入法**：微软拼音（简体中文）等；其他中文 IME 也可能受影响
- **已确认版本**：WebView2 / Edge **149.0.4022.62**（本机开发环境，2026-06-12）

通常 **不受影响**：Firefox、macOS 上的同类浏览器、部分未包含该回归的 Chromium 稳定版。

## 复现步骤

1. 启动 Power Editor（`npm run tauri:dev`）或打开 [codemirror.net](https://codemirror.net/)。
2. 切换到中文输入法（非英文模式）。
3. 在编辑区连续按 `.` 输入句号 `。`（每次间隔约 1 秒，共 4 次）。

**预期**：`。。。。`  
**实际（有 bug 时）**：`。。`（仅一半字符出现）

对比：在同一浏览器的 `<textarea>` 或 `<input>` 中重复操作，通常 4 次都会出现。

## 本项目已排除的原因

以下路径经代码审查，**不是**本 bug 的直接原因：

- `Editor.tsx` 中的 `updateListener`、虚拟加载（`virtualLoad`）、分屏同步
- `syncEditorToRust`、保存与 Rust rope 同步
- `smartEnterKey`、`indentOnInput`、`bracketMatching` 等扩展
- 菜单栏全局 `keydown`（仅拦截 Ctrl 组合键）

若仅在分屏且同一文件双栏时出现「两处同时多一个字」，应单独排查分屏 peer sync，与本文描述的「单字符隔次丢失」不同。

## 验证与排查

### 1. 确认 WebView2 版本

PowerShell：

```powershell
Get-ChildItem "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall","HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  Get-ItemProperty -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "*WebView2*" } |
  Select-Object DisplayName, DisplayVersion
```

### 2. 排除本项目因素

- 仅用浏览器打开 `http://localhost:5173`（`npm run dev`，无 Tauri 后端）在 Firefox 中测试标点输入。
- 若 Firefox 正常、WebView2 / Chrome 异常 → 支持「Chromium 上游问题」判断。

### 3. WebView2 被 Canary 覆盖（少见）

部分开发机通过注册表或环境变量让 WebView2 使用 Chrome Canary / Dev 的二进制，会放大非稳定通道的回归。重装稳定版 WebView2 或恢复默认映射后，现象可能消失（见社区讨论）。

## 应对方式

| 方式 | 说明 |
|------|------|
| **应用层 workaround（已启用）** | 在 Windows + Chromium 149+ 下，通过 `EditorView.contentAttributes.of({ autocorrect: "on" })` 覆盖 CM 默认的 `off`，绕过 TSFTextStore 误拦截。实现见 `src/extensions/chromiumImeAutocorrectWorkaround.ts` |
| **等待上游修复** | [Chromium Issue 521205128](https://issues.chromium.org/issues/521205128) 已合并修复（[CL 7917332](https://chromium-review.googlesource.com/c/chromium/src/+/7917332)）；WebView2 随 Edge 更新后会自动带上修复，届时可移除上述补丁 |
| **临时换浏览器验证** | 开发调试可用 Firefox 打开 Vite 页面，验证编辑逻辑本身 |
| **固定 WebView2 版本** | 打包时指定未受影响的 Fixed Version Runtime（增加部署成本，仅作应急） |

## 跟踪链接

| 资源 | 链接 |
|------|------|
| Chromium issue | https://issues.chromium.org/issues/521205128 |
| CodeMirror 社区讨论 | https://discuss.codemirror.net/t/chinese-ime-punctuation-input-loses-every-other-keypress-requires-2-presses-per-character/9741 |
| CodeMirror 相关 IME 讨论（composition 勿乱改 DOM） | https://discuss.codemirror.net/t/replace-chinese-character-with-other-input-someting-strange/8265 |

## 更新记录

| 日期 | 说明 |
|------|------|
| 2026-06-16 | 启用 `autocorrect="on"` 临时补丁；补充 `autocorrect="off"` 根因与上游 CL 7917332 |
| 2026-06-12 | 初稿：确认本机 WebView2 149.0.4022.62 复现；归类为 Chromium 上游 bug，非项目代码问题 |
