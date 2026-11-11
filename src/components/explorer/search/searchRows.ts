import type { FileHit, LineHit, WorkspaceSearchMode } from '../../../types/workspaceSearch';

export type SearchRow =
  | { kind: 'file'; key: string; file: FileHit; collapsed: boolean }
  | { kind: 'hit'; key: string; file: FileHit; hit: LineHit };

export const ROW_HEIGHT = 22;

/** Flatten results into fixed-height rows (file header + its matching lines). */
export function buildRows(
  files: FileHit[],
  collapsed: ReadonlySet<string>,
  mode: WorkspaceSearchMode,
): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const file of files) {
    const isCollapsed = collapsed.has(file.path);
    rows.push({ kind: 'file', key: file.path, file, collapsed: isCollapsed });
    if (mode === 'content' && !isCollapsed) {
      for (const hit of file.hits) {
        rows.push({ kind: 'hit', key: `${file.path}:${hit.from}`, file, hit });
      }
    }
  }
  return rows;
}

/** Directory part of a `/`-separated relative path ('' for top-level files). */
export function relDir(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}
