import { invoke } from '@tauri-apps/api/core';
import type {
  FileInfo,
  LineChunk,
  EditOp,
  SearchParams,
  FindResult,
  WordfileDef,
} from '../types';
import type { AppSession } from '../types/session';

// ──────────────────────────────────────────────────────────────
// File operations
// ──────────────────────────────────────────────────────────────

export const openFile = (path: string): Promise<FileInfo> =>
  invoke('open_file', { path });

export const newBuffer = (): Promise<FileInfo> =>
  invoke('new_buffer');

export const closeBuffer = (bufferId: number): Promise<void> =>
  invoke('close_buffer', { bufferId });

export const saveBuffer = (bufferId: number): Promise<void> =>
  invoke('save_buffer', { bufferId });

export const saveBufferAs = (bufferId: number, path: string): Promise<FileInfo> =>
  invoke('save_buffer_as', { bufferId, path });

export const renameBuffer = (bufferId: number, newName: string): Promise<FileInfo> =>
  invoke('rename_buffer', { bufferId, newName });

/**
 * Re-read the file from disk into the existing buffer (same bufferId).
 * Call this after the user confirms accepting an externally-made change.
 * The frontend must clear the textEdited flag and reload the CM view afterwards.
 */
export const reloadBuffer = (bufferId: number): Promise<FileInfo> =>
  invoke('reload_buffer', { bufferId });

// ──────────────────────────────────────────────────────────────
// Text access (virtual document)
// ──────────────────────────────────────────────────────────────

export const getLines = (bufferId: number, startLine: number, count: number): Promise<LineChunk> =>
  invoke('get_lines', { bufferId, startLine, count });

/** Return the full Rope content as a single string (used by select-all on large virtual docs). */
export const getFullText = (bufferId: number): Promise<string> =>
  invoke('get_full_text', { bufferId });

export const applyEdit = (bufferId: number, op: EditOp): Promise<FileInfo> =>
  invoke('apply_edit', { bufferId, op });

export const getBufferInfo = (bufferId: number): Promise<FileInfo> =>
  invoke('get_buffer_info', { bufferId });

// ──────────────────────────────────────────────────────────────
// Search & Replace
// ──────────────────────────────────────────────────────────────

export const findAll = (bufferId: number, params: SearchParams, maxResults = 10000): Promise<FindResult> =>
  invoke('find_all', { bufferId, params, maxResults });

export const replaceAll = (bufferId: number, params: SearchParams, replacement: string): Promise<number> =>
  invoke('replace_all', { bufferId, params, replacement });

export const replaceOne = (bufferId: number, from: number, to: number, replacement: string): Promise<void> =>
  invoke('replace_one', { bufferId, from, to, replacement });

// ──────────────────────────────────────────────────────────────
// Encoding & Line Endings
// ──────────────────────────────────────────────────────────────

export const getSupportedEncodings = (): Promise<string[]> =>
  invoke('get_supported_encodings');

export const changeEncoding = (bufferId: number, encoding: string): Promise<FileInfo> =>
  invoke('change_encoding', { bufferId, encoding });

/** Re-open the file with a different encoding. Returns a new FileInfo with a new bufferId. */
export const reopenWithEncoding = (bufferId: number, encoding: string): Promise<FileInfo> =>
  invoke('reopen_with_encoding', { bufferId, encoding });

export const convertLineEndings = (bufferId: number, target: 'LF' | 'CRLF'): Promise<FileInfo> =>
  invoke('convert_line_endings', { bufferId, target });

// ──────────────────────────────────────────────────────────────
// Wordfile / Syntax
// ──────────────────────────────────────────────────────────────

export const loadWordfiles = (): Promise<WordfileDef[]> =>
  invoke('load_wordfiles');

export const parseWordfileContent = (content: string): Promise<WordfileDef> =>
  invoke('parse_wordfile_content', { content });

export const importWordfileFromPath = (path: string): Promise<WordfileDef> =>
  invoke('import_wordfile_from_path', { path });

export const saveImportedWordfile = (path: string): Promise<WordfileDef> =>
  invoke('save_imported_wordfile', { path });

// ──────────────────────────────────────────────────────────────
// Session / Scratch
// ──────────────────────────────────────────────────────────────

/** Export a buffer's full Rope to a scratch file. Returns the scratch file path. */
export const exportBufferToScratch = (bufferId: number): Promise<string> =>
  invoke('export_buffer_to_scratch', { bufferId });

/**
 * Create a new buffer from scratch file content, then delete the scratch file.
 * `originalPath` is restored as the buffer's path (empty string = unsaved new file).
 */
export const openScratchAsBuffer = (
  scratchPath: string,
  originalPath: string,
  encoding: string,
  lineEnding: string,
): Promise<FileInfo> =>
  invoke('open_scratch_as_buffer', { scratchPath, originalPath, encoding, lineEnding });

/** Persist session JSON to app_data_dir/session.json. */
export const saveSession = (session: AppSession): Promise<void> =>
  invoke('save_session', { session });

/** Load session from app_data_dir/session.json. Returns null if none exists. */
export const loadSession = (): Promise<AppSession | null> =>
  invoke('load_session');

/** Delete only session.json (scratch files remain for restore to use). */
export const clearSession = (): Promise<void> =>
  invoke('clear_session');

/** Delete all orphaned scratch files after restore is complete. */
export const cleanupScratchDir = (): Promise<void> =>
  invoke('cleanup_scratch_dir');

/** Tell Rust to exit the process after session has been saved. */
export const confirmCloseApp = (): Promise<void> =>
  invoke('confirm_close_app');

// ──────────────────────────────────────────────────────────────
// CSV Conversion
// ──────────────────────────────────────────────────────────────

export interface CsvDetectResult {
  delimiter: string;
  field_widths: number[];
}

export interface CsvToFixedWidthOptions {
  delimiter: string;
  fieldWidths: number[];
  ignoreSingleQuotes: boolean;
  ignoreDoubleQuotes: boolean;
}

export const csvDetect = (bufferId: number, maxLines: number): Promise<CsvDetectResult> =>
  invoke('csv_detect', { bufferId, maxLines });

export const csvToFixedWidth = (bufferId: number, opts: CsvToFixedWidthOptions): Promise<FileInfo> =>
  invoke('csv_to_fixed_width', {
    bufferId,
    delimiter: opts.delimiter,
    fieldWidths: opts.fieldWidths,
    ignoreSingleQuotes: opts.ignoreSingleQuotes,
    ignoreDoubleQuotes: opts.ignoreDoubleQuotes,
  });

// ──────────────────────────────────────────────────────────────
// Shell / Explorer Integration (Windows)
// ──────────────────────────────────────────────────────────────

/** Returns "registered" | "needs_update" | "not_registered". */
export const checkExplorerIntegration = (): Promise<string> =>
  invoke('check_explorer_integration');

/** Write (or overwrite) the Explorer right-click context menu entry. */
export const registerExplorerIntegration = (): Promise<void> =>
  invoke('register_explorer_integration');

/** Remove the Explorer right-click context menu entry. */
export const unregisterExplorerIntegration = (): Promise<void> =>
  invoke('unregister_explorer_integration');

/**
 * Return the file path passed as a CLI argument when the app was launched
 * (e.g. via the Explorer "用 Power Editor 打开" context menu).
 * Returns null if no file was passed, or if already consumed.
 */
export const getStartupFile = (): Promise<string | null> =>
  invoke('get_startup_file');
