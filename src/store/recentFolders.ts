import { atom } from 'jotai';
import { pathsEqual } from '../utils/pathUtils';

const LS_KEY = 'power-editor:recent-folders';
/** Same literal as STORAGE_FOLDER_KEY in explorerAtoms.ts / useExplorer.ts (current workspace folder). */
const LS_CURRENT_FOLDER_KEY = 'power-editor:folder-path';
const MAX = 10;

export function saveRecentFolders(list: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / security errors
  }
}

export function loadRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) {
      // First run after upgrade: seed with the currently opened workspace folder (if any)
      // and persist immediately so the seed survives closing the folder.
      const current = localStorage.getItem(LS_CURRENT_FOLDER_KEY);
      const seed = current ? [current] : [];
      if (seed.length > 0) saveRecentFolders(seed);
      return seed;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Move `path` to the front (deduped via pathsEqual), capped at MAX entries. */
export function addToRecentFolders(list: string[], path: string): string[] {
  const deduped = list.filter((p) => !pathsEqual(p, path));
  return [path, ...deduped].slice(0, MAX);
}

/** Order-preserving dedupe via pathsEqual, capped at MAX entries. */
export function dedupeRecentFolders(list: string[]): string[] {
  const out: string[] = [];
  for (const p of list) {
    if (!out.some((q) => pathsEqual(q, p))) out.push(p);
  }
  return out.slice(0, MAX);
}

export const recentFoldersAtom = atom<string[]>(loadRecentFolders());
