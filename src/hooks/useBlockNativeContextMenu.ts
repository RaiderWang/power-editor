import { useEffect } from 'react';

/**
 * Global hook to suppress WebView2's default context menu across the application.
 *
 * Rules:
 * - Text inputs (<input>, <textarea>, [contenteditable="true"]) keep their native
 *   context menu so standard cut/copy/paste works inside dialogs and search inputs.
 * - In development mode (`import.meta.env.DEV`), holding Shift allows the native
 *   context menu through for DevTools / element inspection.
 * - Everywhere else (editor background, preview pane, statusbar, empty workspace, etc.),
 *   the native browser context menu is blocked.
 */
export function useBlockNativeContextMenu(): void {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow Shift+RightClick in dev mode to open WebView2 DevTools / Inspect
      if (import.meta.env.DEV && e.shiftKey) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tagName = target.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
        return;
      }

      if (target.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      // CodeMirror editor area (including read-only tabs whose content is not
      // contenteditable): let the CM extension show the custom menu. Calling
      // preventDefault() here would make CM skip its own contextmenu handler.
      if (target.closest('.cm-editor')) {
        return;
      }

      e.preventDefault();
    };

    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    };
  }, []);
}
