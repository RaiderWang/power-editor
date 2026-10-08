"""
Extract release notes from CHANGELOG.md and update GitHub Release via GitHub CLI.
Used in GitHub Actions release workflow.
"""

import os
import re
import subprocess
import sys

# Ensure UTF-8 output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def extract_changelog(version: str, changelog_path: str = 'CHANGELOG.md') -> str:
    """Extract section for the given version from CHANGELOG.md."""
    if not os.path.isfile(changelog_path):
        print(f"Warning: {changelog_path} not found.")
        return ""

    with open(changelog_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern matches "## [0.2.1]..." up to the next "## [" or end of file
    pattern = rf'## \[{re.escape(version)}\][^\n]*\n(.*?)(?=\n## \[|\Z)'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print(f"Warning: Version [{version}] not found in {changelog_path}.")
        return ""

    notes = match.group(1).strip()
    # Strip trailing markdown horizontal rules
    notes = re.sub(r'\n+---\s*$', '', notes).strip()
    return notes


def generate_release_body(tag: str, version: str, notes: str) -> str:
    """Compose full release body with changelog notes and installation guide."""
    header = f"## Power Editor {tag}\n\n"

    if notes:
        changes = f"### 🚀 What's Changed / 版本变更\n\n{notes}\n\n---\n\n"
    else:
        changes = ""

    install_guide = f"""### 📦 Installation Guide / 安装指南

#### 🍎 macOS
- **Homebrew Cask (Recommended / 推荐)**:
  ```bash
  brew install --cask raiderwang/tap/power-editor
  ```
  *Automatically bypasses Gatekeeper quarantine, no extra command needed.*  
  *（自动处理未签名隔离属性，安装后可直接启动，无需额外命令）*

- **Manual Download (.dmg)**:
  - Apple Silicon (M-series): [`Power.Editor_{version}_aarch64.dmg`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_aarch64.dmg)
  - Intel: [`Power.Editor_{version}_x64.dmg`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_x64.dmg)
  - **If macOS prompts "Power Editor is damaged and can't be opened"（提示已损坏）**, run this command in terminal to clear the quarantine attribute:
    ```bash
    xattr -cr "/Applications/Power Editor.app"
    ```

#### 🪟 Windows
- Download [`Power.Editor_{version}_x64_en-US.msi`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_x64_en-US.msi) (recommended) or [`Power.Editor_{version}_x64-setup.exe`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_x64-setup.exe).
- If Windows SmartScreen prompts on launch, click **More info → Run anyway**（点击“更多信息” → “仍要运行”）.

#### 🐧 Linux
- Download `.AppImage`, `.deb`, or `.rpm`:
  - [`Power.Editor_{version}_amd64.AppImage`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_amd64.AppImage)
  - [`Power.Editor_{version}_amd64.deb`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}_amd64.deb)
  - [`Power.Editor_{version}-1.x86_64.rpm`](https://github.com/RaiderWang/power-editor/releases/download/{tag}/Power.Editor_{version}-1.x86_64.rpm)

---

### ⚙️ System Requirements
- Windows 10/11 x64
- macOS 12+ (Apple Silicon / Intel)
- Linux (x86_64)

### 📄 License
MIT License
"""

    return header + changes + install_guide


def main():
    tag = os.environ.get('TAG')
    if not tag and len(sys.argv) > 1:
        tag = sys.argv[1]

    if not tag:
        print("Error: TAG environment variable or command line argument is required (e.g. v0.2.1).")
        sys.exit(1)

    version = tag.lstrip('v')
    print(f"Extracting changelog for {tag} (version {version})...")

    notes = extract_changelog(version)
    body = generate_release_body(tag, version, notes)

    notes_file = "tmp_release_notes.md"
    try:
        with open(notes_file, 'w', encoding='utf-8') as f:
            f.write(body)

        cmd = ["gh", "release", "edit", tag, "--notes-file", notes_file]
        print(f"Executing: {' '.join(cmd)}")
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')

        if res.returncode != 0:
            print(f"Failed to update release notes: {res.stderr}")
            sys.exit(res.returncode)

        print(f"Successfully updated release notes for {tag}!")
    finally:
        if os.path.exists(notes_file):
            os.remove(notes_file)


if __name__ == '__main__':
    main()
