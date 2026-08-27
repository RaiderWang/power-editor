# 银河麒麟 / Linux (ARM64 & x86_64) 编译与运行指南

本文档详细记录了在 **银河麒麟桌面操作系统 V10 SP1**（ARM64 / 麒麟 9000C）及其他 Linux 环境下编译、打包、运行 Power Editor 的完整流程与技术说明。

---

## 1. 背景与底层依赖分析

### 1.1 为什么直接运行原生编译二进制会打不开？
- **麒麟系统宿主机基线**：银河麒麟 V10 SP1 底层基于 **Ubuntu 20.04 (Focal)**，系统默认的 C 运行库为 **GLIBC 2.31**，Web 渲染库为 **WebKitGTK 4.0**（`libwebkit2gtk-4.0.so.37` + `libsoup-2.4`）。
- **Tauri 2.0 依赖要求**：**Tauri 2.0** 在 Linux 平台的底层渲染库已全面升级为 **WebKitGTK 4.1**（`libwebkit2gtk-4.1.so.0` + `libsoup-3.0`），且其 Rust 绑定库要求 **GLib >= 2.70**。
- **运行报错原因**：
  若在基于 Ubuntu 22.04 的 Docker 环境中编译出的二进制，其依赖了高版本的 `GLIBC 2.34` 与 `libwebkit2gtk-4.1.so.0`。因此在麒麟 V10 SP1 宿主机直接点击执行时，会因宿主机系统缺少 `libwebkit2gtk-4.1.so.0` 和 `GLIBC 2.34` 而闪退。

---

## 2. 解决方案：Docker 容器隔离构建 + X11 GUI 宿主环境直通

为了在不破坏麒麟系统原有桌面库的前提下实现正常编译与日常使用：
1. **编译阶段**：使用基于 Ubuntu 22.04 aarch64 的 `power-editor-builder` 容器编译出完整的 Release 二进制与 Linux 安装包。
2. **运行阶段**：
   - 继承宿主机当前登录用户身份（UID/GID）、主目录与中文字体环境。
   - 挂载宿主机 `$HOME`、`/data` 数据盘、`/backup` 备份盘、`/media`、`/mnt` 等所有磁盘分区。
   - **自动检测并继承系统 HiDPI 屏幕缩放**（支持 125%、150%、200% 等缩放比例）。
   - 文件选择对话框左侧导航（主文件夹、桌面、下载、文档、数据盘等）与宿主机原生体验完全一致。

---

## 3. 一键编译与打包

### 3.1 首次构建准备
确保宿主机已安装 Docker 并启动服务：

```bash
sudo apt update && sudo apt install -y docker.io
sudo systemctl enable --now docker
```

### 3.2 执行一键构建
在项目根目录下运行：

```bash
./scripts/build-linux-docker.sh
```

构建完成后，产物位于 `src-tauri/target/release/`：
- **原生二进制**：`src-tauri/target/release/power-editor`
- **DEB 安装包**：`src-tauri/target/release/bundle/deb/Power Editor_0.1.3_arm64.deb`（适用于 Ubuntu 22.04+ / 统信 UOS / Debian 12+）
- **AppImage 独立单文件**：`src-tauri/target/release/bundle/appimage/Power Editor_0.1.3_aarch64.AppImage`

---

## 4. 麒麟桌面开始菜单与系统一键启动配置

系统已配置以下启动项以实现一键秒开：

### 4.1 终端启动命令
直接在任意终端中执行：

```bash
power-editor [文件路径]
```

### 4.2 开始菜单 / 桌面图标
系统已自动创建 `/usr/share/applications/power-editor.desktop` 与高清应用图标：
- 点击麒麟任务栏开始菜单 -> **实用工具 / 开发工具** -> **Power Editor** 即可直接打开。
- 支持右键发送快捷方式到桌面。

---

## 5. 常见问题排查与关键配置说明

### Q1：界面中文显示为方框（“豆腐块”）、编辑器内中文无法正常显示
- **问题现象**：切换为中文语言后，菜单、状态栏或编辑器内打开的文件中的汉字全变为方框乱码。
- **产生原因**：基础 Linux 容器镜像（`ubuntu:22.04`）默认只包含英文 ASCII 基础字体，未安装任何 CJK（中日韩）字体库，WebKitGTK 图形引擎找不到中文字形时会回退为方块（tofu）。
- **解决办法**：
  1. 在 `Dockerfile.build` 中预装 `fonts-noto-cjk`（思源黑体）、`fonts-wqy-zenhei`（文泉驿正黑）、`fonts-wqy-microhei`，并生成 `zh_CN.UTF-8` 语言环境。
  2. 在启动脚本 `/usr/local/bin/power-editor` 中通过 `-v /usr/share/fonts:/usr/share/fonts:ro -v /etc/fonts:/etc/fonts:ro` 直通宿主机（麒麟）字体库，并注入 `-e LANG="zh_CN.UTF-8" -e LC_ALL="zh_CN.UTF-8"`。

---

### Q2：打开文件对话框中路径错误（指向 /root）、桌面空白、看不到数据盘
- **问题现象**：在编辑器中点击「打开文件」时，左侧导航栏的「主文件夹」和「桌面」内容为空，且无法看到主机的 `/data` 数据盘。
- **产生原因**：
  1. 容器默认以 `root` 身份运行（`HOME=/root`），GTK 对话框的“主文件夹”和“桌面”指向了容器内部的空目录 `/root` 和 `/root/Desktop`。
  2. 宿主机的 `/data`（数据盘）、`/backup`（备份盘）等分区未挂载到容器内，且 GTK 缺少宿主磁盘书签。
- **解决办法**：
  1. 启动脚本中传入 `-u $(id -u):$(id -g) -e HOME="$HOME" -e USER="$USER"` 及 `/etc/passwd`、`/etc/group` 映射，使容器以宿主机当前登录用户（如 `cmcc: 1000`）运行。
  2. 挂载宿主机真实主目录 `-v "${CURRENT_HOME}:${CURRENT_HOME}"` 及全部磁盘 `-v /data:/data -v /backup:/backup -v /media:/media -v /mnt:/mnt`。
  3. 在 `~/.config/gtk-3.0/bookmarks` 中写入桌面、文档、下载、数据盘等快捷入口，GTK 文件选择器即可自动展示原生侧边栏导航。

---

### Q3：高分屏（HiDPI）界面与字体偏小，未跟随系统 150% 缩放
- **问题现象**：在 2K 屏幕（2160×1440）下，应用界面元素和字体过小，未按系统设置的 150% 比例缩放。
- **产生原因**：容器内无法自动读取宿主机桌面守护进程（`ukui-settings-daemon`）的 D-Bus 会话参数，导致默认以 100% 原始分辨率（96 DPI）渲染。
- **解决办法**：
  - 启动脚本中自动调用 `gsettings` 读取 `ukui.SettingsDaemon.plugins.xsettings scaling-factor`（或由 `Xft.dpi` 计算缩放比），动态计算并向容器注入 `-e GDK_DPI_SCALE="1.5"`，同时透传 `DBUS_SESSION_BUS_ADDRESS`。

---

### Q4：右上角窗口控制按钮（最小化、最大化、关闭）尺寸未缩放
- **问题现象**：界面文字与内容已放大，但窗口标题栏右上角的三个控制按钮依然很小。
- **产生原因**：GTK 3 的 `GDK_DPI_SCALE` 仅影响文字排版；标题栏控件（HeaderBar / CSD）按钮尺寸由 GTK 3 主题样式与图标缩放规则决定。
- **解决办法**：
  - 在 `~/.config/gtk-3.0/gtk.css` 中为标题栏按钮增加样式：
    ```css
    headerbar button.titlebutton image,
    windowcontrols button image,
    button.titlebutton image {
      -gtk-icon-transform: scale(1.5);
      min-width: 24px;
      min-height: 24px;
    }
    headerbar button.titlebutton,
    button.titlebutton {
      min-width: 38px;
      min-height: 34px;
      padding: 4px 8px;
    }
    ```
  - 并在启动脚本中挂载宿主机的 `/usr/share/themes` 与 `/usr/share/icons`。

---

### Q5：中文输入法（Fcitx / 搜狗输入法 / Fcitx5 / IBus）无法激活或候选框不显示
- **问题现象**：在编辑器或查找/替换输入框中按 `Ctrl+Space`、`Shift` 或快捷键切换中文输入法时没有任何反应，只能输入英文字符，输入法候选框无法弹出。
- **产生原因**：
  1. **容器缺少 GTK IM 模块**：GTK 3 与 WebKitGTK 需要对应的输入法前端模块（如 `im-fcitx.so`、`im-ibus.so`）才能与系统输入法守护进程通信。标准基础镜像中缺少 `fcitx-frontend-gtk3`、`fcitx5-frontend-gtk3`、`ibus-gtk3` 等包，且未生成 `gtk-query-immodules-3.0` 缓存。
  2. **环境变量与套接字未透传**：容器内未设置 `GTK_IM_MODULE`、`QT_IM_MODULE`、`XMODIFIERS`，且未挂载 `/tmp/.XIM-unix` 与 `/etc/machine-id`。
  3. **WebKitGTK 进程沙箱限制**：WebKitGTK 默认开启的 WebProcess 沙箱在容器内会阻止网页渲染进程与 D-Bus/Fcitx 通信，导致页面内无法接收输入法组合事件。
- **解决办法**：
  1. 在 `Dockerfile.build` 中安装 `fcitx-frontend-gtk3`、`fcitx5-frontend-gtk3`、`ibus-gtk3`、`libgtk-3-bin`、`dbus-x11` 并更新 `immodules` 缓存。
  2. 启动脚本中自动检测宿主机输入法类型并向容器注入：
     ```bash
     -e GTK_IM_MODULE="${HOST_GTK_IM}" \
     -e QT_IM_MODULE="${HOST_QT_IM}" \
     -e XMODIFIERS="${HOST_XMODIFIERS}" \
     -e CLUTTER_IM_MODULE="${HOST_GTK_IM}" \
     -e SDL_IM_MODULE="${HOST_GTK_IM}" \
     -e WEBKIT_FORCE_SANDBOX=0 \
     -v /tmp/.XIM-unix:/tmp/.XIM-unix \
     -v /etc/machine-id:/etc/machine-id:ro
     ```
  3. 重新构建容器镜像并更新启动脚本：
     ```bash
     ./scripts/build-linux-docker.sh
     ```

