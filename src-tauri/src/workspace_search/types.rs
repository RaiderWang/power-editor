//! Wire types of the folder search (mirrored by `src/types/workspaceSearch.ts`).

use serde::{Deserialize, Serialize};

use crate::search::SearchParams;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// Match the file name only (no file content is read).
    Name,
    /// Match file content (text files only).
    Content,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSearchParams {
    pub root: String,
    pub mode: SearchMode,
    pub search: SearchParams,
    /// Also visit `.gitignore`d / hidden files and `node_modules`.
    pub include_ignored: bool,
}

/// One matching line of a file (content mode).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LineHit {
    /// 0-based line number in the LF-normalised document (same as the Rope).
    pub line: u64,
    /// Absolute UTF-8 byte offsets of the match in the normalised document
    /// (the same coordinates as `SearchMatch.from` / `.to`). `to` is clipped to the line end.
    pub from: u64,
    pub to: u64,
    /// The matching line, cut around the match (may start/end with `…`).
    pub preview: String,
    /// Highlight range inside `preview`, in UTF-16 code units (JS string indices).
    pub hl_start: u32,
    pub hl_end: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileHit {
    pub path: String,
    /// Path relative to the search root, `/`-separated.
    pub rel_path: String,
    pub name: String,
    /// Content mode: encoding the offsets were computed with (`Encoding::name`).
    pub encoding: String,
    /// Name mode: highlight range inside `name` (UTF-16 code units).
    pub name_hl: Option<(u32, u32)>,
    pub hits: Vec<LineHit>,
    /// More matching lines exist than were returned (per-file cap).
    pub more: bool,
}

/// A throttled progress/result batch (wrapped with the job id by the command layer).
#[derive(Debug, Clone, Serialize, Default)]
pub struct SearchBatch {
    pub files: Vec<FileHit>,
    pub scanned_files: u64,
    pub hit_files: u64,
    pub hit_count: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SearchSummary {
    pub scanned_files: u64,
    pub hit_files: u64,
    pub hit_count: u64,
    /// Files skipped because they look binary.
    pub skipped_binary: u64,
    /// Lines longer than the carry limit that had to be cut (matches across the cut may be missed).
    pub long_lines_cut: u64,
    /// The global result cap was reached and the search stopped early.
    pub truncated: bool,
    pub cancelled: bool,
    pub elapsed_ms: u64,
}
