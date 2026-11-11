/** Markdown preview zoom limits (percent). Pure module: safe to import from `editorPrefs.ts`. */
export const PREVIEW_ZOOM_MIN = 50;
export const PREVIEW_ZOOM_MAX = 300;
export const PREVIEW_ZOOM_STEP = 10;
export const PREVIEW_ZOOM_DEFAULT = 100;

/** Coerce any value (possibly dirty persisted data) into a valid integer zoom percent. */
export function clampPreviewZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PREVIEW_ZOOM_DEFAULT;
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value)));
}
