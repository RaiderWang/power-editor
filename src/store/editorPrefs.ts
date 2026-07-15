const LS_KEY = 'power-editor:editor-prefs';

export type Locale = 'zh-CN' | 'en-US';

export interface EditorPrefs {
  fontSize: number;
  fontFamily: string;
  lineWrap: boolean;
  showLineNumbers: boolean;
  tabSize: number;
  theme: 'dark' | 'light';
  locale: Locale;
}

export const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 14,
  fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
  lineWrap: false,
  showLineNumbers: true,
  tabSize: 4,
  theme: 'dark',
  locale: 'zh-CN',
};

/** Load editor prefs from localStorage, merging with defaults to handle missing keys. */
export function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
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
