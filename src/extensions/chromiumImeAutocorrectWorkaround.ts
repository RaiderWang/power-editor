import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Chromium 149+ on Windows reverts IME punctuation when contenteditable has
 * autocorrect="off" (CodeMirror default). Force "on" until WebView2 ships the
 * upstream fix (https://issues.chromium.org/issues/521205128).
 */
function needsChromiumImeAutocorrectWorkaround(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (!/Windows/i.test(ua)) return false;
  const match = ua.match(/Chrom(?:e|ium)\/(\d+)/);
  if (!match) return false;
  return parseInt(match[1], 10) >= 149;
}

export function chromiumImeAutocorrectWorkaround(): Extension {
  if (!needsChromiumImeAutocorrectWorkaround()) return [];
  return EditorView.contentAttributes.of({ autocorrect: 'on' });
}
