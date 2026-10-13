import { atom } from 'jotai';

const STORAGE_FOLDER_KEY = 'power-editor:folder-path';
const STORAGE_SIDEBAR_VISIBLE_KEY = 'power-editor:sidebar-visible';
const STORAGE_SIDEBAR_WIDTH_KEY = 'power-editor:sidebar-width';

function loadInitialFolderPath(): string | null {
  try {
    return localStorage.getItem(STORAGE_FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

function loadInitialSidebarVisible(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_SIDEBAR_VISIBLE_KEY);
    if (val !== null) {
      return val === 'true';
    }
    // Default to true if a folder path is stored
    return Boolean(localStorage.getItem(STORAGE_FOLDER_KEY));
  } catch {
    return true;
  }
}

function loadInitialSidebarWidth(): number {
  try {
    const val = localStorage.getItem(STORAGE_SIDEBAR_WIDTH_KEY);
    if (val) {
      const parsed = parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed >= 160 && parsed <= 600) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  return 260;
}

// ──────────────────────────────────────────────────────────────
// Explorer Atoms
// ──────────────────────────────────────────────────────────────

export const currentFolderPathAtom = atom<string | null>(loadInitialFolderPath());

export const sidebarVisibleAtom = atom<boolean>(loadInitialSidebarVisible());

export const sidebarWidthAtom = atom<number>(loadInitialSidebarWidth());

export const selectedPathAtom = atom<string | null>(null);

/** Set of expanded directory paths */
export const expandedFoldersAtom = atom<string[]>([]);

/** Incremented to force the file tree to re-fetch */
export const explorerRefreshTriggerAtom = atom<number>(0);
