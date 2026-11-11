import type { EditorPrefs } from './editorPrefs';
import { PREVIEW_ZOOM_DEFAULT, clampPreviewZoom } from './previewZoomLimits';

/** DOM marker placed on the Markdown preview pane root (`data-preview-pane` in MarkdownPreviewPane.tsx). */
export const PREVIEW_PANE_ATTR = 'data-preview-pane';

/**
 * True while keyboard focus is inside the Markdown preview pane (body, header, links or buttons).
 * Font-size shortcuts (Ctrl+= / Ctrl+- / Ctrl+0) then target the preview zoom instead of the editor.
 */
export function isPreviewFocused(): boolean {
  const el = document.activeElement;
  return el instanceof Element && el.closest(`[${PREVIEW_PANE_ATTR}]`) !== null;
}

type SetPrefs = (updater: (prev: EditorPrefs) => EditorPrefs) => void;

/** Step the preview zoom by `delta` percent, or reset it to 100% with `'reset'`. */
export function adjustPreviewZoom(setPrefs: SetPrefs, delta: number | 'reset'): void {
  setPrefs((p) => ({
    ...p,
    previewZoom: delta === 'reset' ? PREVIEW_ZOOM_DEFAULT : clampPreviewZoom(p.previewZoom + delta),
  }));
}
