import type { SearchParams } from './index';

/** Mirrors `src-tauri/src/workspace_search/types.rs`. */

export type WorkspaceSearchMode = 'name' | 'content';

export interface WorkspaceSearchParams {
  root: string;
  mode: WorkspaceSearchMode;
  search: SearchParams;
  include_ignored: boolean;
}

export interface LineHit {
  /** 0-based line in the LF-normalised document. */
  line: number;
  /** Absolute UTF-8 byte offsets in the normalised document (Rope coordinates). */
  from: number;
  to: number;
  preview: string;
  /** Highlight range inside `preview` (UTF-16 code units). */
  hl_start: number;
  hl_end: number;
}

export interface FileHit {
  path: string;
  rel_path: string;
  name: string;
  /** Encoding the offsets were computed with (content mode). */
  encoding: string;
  /** Name mode: highlight range inside `name`. */
  name_hl: [number, number] | null;
  hits: LineHit[];
  more: boolean;
}

export interface WorkspaceSearchBatch {
  job_id: string;
  files: FileHit[];
  scanned_files: number;
  hit_files: number;
  hit_count: number;
}

export interface WorkspaceSearchDone {
  job_id: string;
  scanned_files: number;
  hit_files: number;
  hit_count: number;
  skipped_binary: number;
  long_lines_cut: number;
  truncated: boolean;
  cancelled: boolean;
  elapsed_ms: number;
}
