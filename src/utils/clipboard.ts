import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Writes text to system clipboard.
 * Prefers the Tauri clipboard plugin (avoids permission prompts and IPC restrictions),
 * with graceful fallback to standard navigator.clipboard.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch (pluginErr) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (navErr) {
      console.error('[clipboard] writeClipboardText failed:', { pluginErr, navErr });
      return false;
    }
    console.error('[clipboard] writeClipboardText failed:', pluginErr);
    return false;
  }
}

/**
 * Reads plain text from system clipboard via the Tauri clipboard plugin.
 * Returns empty string on error or if the clipboard holds no text (e.g. an image).
 * No navigator.clipboard fallback: it would prompt for permission and double-report
 * the same "no text available" condition.
 */
export async function readClipboardText(): Promise<string> {
  try {
    const text = await readText();
    return text ?? '';
  } catch (err) {
    console.warn('[clipboard] readClipboardText: no text available:', err);
    return '';
  }
}
