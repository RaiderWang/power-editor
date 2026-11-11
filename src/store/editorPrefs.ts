import { PREVIEW_ZOOM_DEFAULT, clampPreviewZoom } from './previewZoomLimits';

const LS_KEY = 'power-editor:editor-prefs';

export type Locale = 'zh-CN' | 'en-US';

export interface EditorPrefs {
  fontSize: number;
  /** Markdown preview zoom in percent (50-300). */
  previewZoom: number;
  fontFamily: string;
  lineWrap: boolean;
  showLineNumbers: boolean;
  tabSize: number;
  theme: 'dark' | 'light';
  locale: Locale;
  printLineNumbers: boolean;
  warnOnLargeFile: boolean;
  autoCheckUpdates: boolean;
  skippedUpdateVersion: string;
}

export const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 14,
  previewZoom: PREVIEW_ZOOM_DEFAULT,
  fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
  lineWrap: false,
  showLineNumbers: true,
  tabSize: 4,
  theme: 'dark',
  locale: 'en-US',
  printLineNumbers: false,
  warnOnLargeFile: true,
  autoCheckUpdates: true,
  skippedUpdateVersion: '',
};

/** Load editor prefs from localStorage, merging with defaults to handle missing keys. */
export function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const merged: EditorPrefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    merged.previewZoom = clampPreviewZoom(merged.previewZoom);
    return merged;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveEditorPrefs(prefs: EditorPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / security errors
  }
}
