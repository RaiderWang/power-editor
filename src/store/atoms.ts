import { atom } from 'jotai';
import type { TabState, LanguageDef, SearchParams, SearchMatch } from '../types';
import { loadEditorPrefs } from './editorPrefs';
export type { EditorPrefs } from './editorPrefs';

// ──────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────

export const tabsAtom = atom<TabState[]>([]);
export const activeTabIdAtom = atom<string | null>(null);

export const activeTabAtom = atom((get) => {
  const tabs = get(tabsAtom);
  const id = get(activeTabIdAtom);
  return tabs.find((t) => t.id === id) ?? null;
});

// ──────────────────────────────────────────────────────────────
// Available language definitions (from wordfiles)
// ──────────────────────────────────────────────────────────────

export const languageDefsAtom = atom<LanguageDef[]>([]);

// ──────────────────────────────────────────────────────────────
// Search panel
// ──────────────────────────────────────────────────────────────

export const searchOpenAtom = atom<boolean>(false);
/** Incremented every time the search panel is opened (or re-opened while already open). */
export const searchTriggerAtom = atom<number>(0);
export const searchParamsAtom = atom<SearchParams>({
  pattern: '',
  is_regex: false,
  case_sensitive: false,
  whole_word: false,
});
export const searchMatchesAtom = atom<SearchMatch[]>([]);
export const searchTotalAtom = atom<number>(0);
export const currentMatchIndexAtom = atom<number>(-1);

// ──────────────────────────────────────────────────────────────
// Editor preferences  (persisted via localStorage, see editorPrefs.ts)
// ──────────────────────────────────────────────────────────────

export const editorPrefsAtom = atom(loadEditorPrefs());

// ──────────────────────────────────────────────────────────────
// Supported encodings (loaded from Rust once)
// ──────────────────────────────────────────────────────────────

export const supportedEncodingsAtom = atom<string[]>([]);

// ──────────────────────────────────────────────────────────────
// Column mode
// ──────────────────────────────────────────────────────────────

export const columnModeAtom = atom<boolean>(false);

// ──────────────────────────────────────────────────────────────
// Pending close confirmation (tabId waiting for user decision)
// ──────────────────────────────────────────────────────────────

export const pendingCloseTabIdAtom = atom<string | null>(null);

// ──────────────────────────────────────────────────────────────
// External file modification (tabId whose file changed on disk)
// ──────────────────────────────────────────────────────────────

export const externalChangeTabIdAtom = atom<string | null>(null);
