const SEARCH_KEY = 'power-editor:search-history';
const REPLACE_KEY = 'power-editor:replace-history';
const MAX = 10;

function loadHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addHistory(key: string, term: string): void {
  if (!term) return;
  try {
    const list = loadHistory(key);
    const deduped = list.filter((t) => t !== term);
    localStorage.setItem(key, JSON.stringify([term, ...deduped].slice(0, MAX)));
  } catch {
    // ignore quota / security errors
  }
}

export function loadSearchHistory(): string[] {
  return loadHistory(SEARCH_KEY);
}

export function addSearchHistory(term: string): void {
  addHistory(SEARCH_KEY, term);
}

export function loadReplaceHistory(): string[] {
  return loadHistory(REPLACE_KEY);
}

export function addReplaceHistory(term: string): void {
  addHistory(REPLACE_KEY, term);
}
