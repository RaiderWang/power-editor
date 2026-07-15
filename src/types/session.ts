/// Per-tab session data persisted across restarts.
export interface TabSession {
  /** Original file path. Empty string for unsaved new buffers. */
  path: string;
  /** Scratch file path storing unsaved content; null for clean saved files. */
  scratch_path: string | null;
  cursor_line: number;
  cursor_col: number;
  scroll_top: number;
  language: string | null;
  encoding: string;
  line_ending: string;
}

/// Top-level session persisted to app_data_dir/session.json.
export interface AppSession {
  /** Index into `tabs` that was active at close time. */
  active_tab_index: number;
  tabs: TabSession[];
}
