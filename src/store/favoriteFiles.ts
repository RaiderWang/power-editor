import { atom } from 'jotai';

const LS_KEY = 'power-editor:favorite-files';

export function loadFavoriteFiles(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFavoriteFiles(list: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / security errors
  }
}

/** 已收藏则移除，未收藏则添加到头部。 */
export function toggleFavorite(list: string[], path: string): string[] {
  if (list.includes(path)) {
    return list.filter((p) => p !== path);
  }
  return [path, ...list];
}

export const favoriteFilesAtom = atom<string[]>(loadFavoriteFiles());
