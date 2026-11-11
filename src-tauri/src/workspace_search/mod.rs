//! Folder search (file name / file content) used by the Explorer sidebar.
//!
//! * `walk`    – parallel traversal (`ignore`), per-file matching, throttled batching
//! * `content` – streaming, Rope-coordinate-exact scanner for one file
//! * `preview` – line preview + newline normalisation helpers
//! * `jobs`    – cancellable job registry
//! * `types`   – wire types

pub mod content;
pub mod jobs;
pub mod preview;
pub mod types;
pub mod walk;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_edge;

pub use jobs::WorkspaceSearchJobs;
pub use types::{SearchBatch, SearchMode, SearchSummary, WorkspaceSearchParams};
