import { atom } from 'jotai';

const LS_KEY = 'power-editor:recent-files';
const MAX = 10;

export function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentFiles(list: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / security errors
  }
}

export function addToRecent(list: string[], path: string): string[] {
  const deduped = list.filter((p) => p !== path);
  return [path, ...deduped].slice(0, MAX);
}

export const recentFilesAtom = atom<string[]>(loadRecentFiles());
