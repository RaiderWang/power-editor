// ──────────────────────────────────────────────────────────────
// Core types mirroring the Rust structs (kept in sync with lib.rs)
// ──────────────────────────────────────────────────────────────

export interface FileInfo {
  id: number;
  path: string;
  total_lines: number;
  total_bytes: number;
  encoding: string;
  line_ending: 'LF' | 'CRLF' | 'Mixed';
  is_modified: boolean;
}

export interface LineChunk {
  start_line: number;
  lines: string[];
  total_lines: number;
  /** UTF-8 byte offset of the first char of `start_line` in the full file. */
  start_byte_offset: number;
  /** UTF-8 byte offset just past the last char of the last line in this chunk. */
  end_byte_offset: number;
}

export interface EditOp {
  from: number;
  to: number;
  text: string;
}

export interface SearchParams {
  pattern: string;
  is_regex: boolean;
  case_sensitive: boolean;
  whole_word: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
  line: number;
  column: number;
  preview: string;
}

export interface FindResult {
  matches: SearchMatch[];
  total: number;
  truncated: boolean;
}

// ──────────────────────────────────────────────────────────────
// Wordfile / Syntax types
// ──────────────────────────────────────────────────────────────

export interface LanguageDef {
  name: string;
  extensions: string[];
  case_sensitive: boolean;
  keyword_groups: string[][];
  line_comment: string | null;
  block_comment_start: string | null;
  block_comment_end: string | null;
  string_chars: string[];
  delimiters: string;
  indent_with: string | null;
}

export interface WordfileDef {
  languages: LanguageDef[];
}

// ──────────────────────────────────────────────────────────────
// Tab / editor state
// ──────────────────────────────────────────────────────────────

export interface TabState {
  id: string;            // unique tab id (UUID)
  bufferId: number;      // Rust buffer id
  fileInfo: FileInfo;
  /** Display / save-as default name for unsaved tabs (no path on disk yet). */
  untitledName?: string;
  cursorLine: number;
  cursorCol: number;
  scrollTop: number;
  language: string | null;
}
