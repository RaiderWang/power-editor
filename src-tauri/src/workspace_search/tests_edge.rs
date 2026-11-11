//! Zero-width regex matches (`^$`, `^`, `$`) across chunk boundaries and result caps.

use std::io::Cursor;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use encoding_rs::UTF_8;

use super::content::{scan_reader, ScanConfig, ScanResult};
use super::tests::{editor_text, params};
use super::types::{FileHit, SearchBatch, SearchMode, SearchSummary, WorkspaceSearchParams};
use super::walk::{self, Limits};
use crate::search::{build_regex, SearchParams};

fn scan_with(text: &str, pattern: &str, cfg: &ScanConfig) -> ScanResult {
    let re = build_regex(&SearchParams { is_regex: true, ..params(pattern) }).unwrap();
    scan_reader(
        &mut Cursor::new(text.as_bytes()),
        text.len() as u64,
        &re,
        &AtomicBool::new(false),
        cfg,
        Some(UTF_8),
    )
    .unwrap()
}

fn lines(res: &ScanResult) -> Vec<u64> {
    res.hits.iter().map(|h| h.line).collect()
}

#[test]
fn caret_dollar_finds_empty_lines() {
    let text = "a\n\nb\n\nc";
    let res = scan_with(text, "^$", &ScanConfig::default());
    assert_eq!(lines(&res), vec![1, 3]);
    assert_eq!(editor_text(text.as_bytes()), text);
    for h in &res.hits {
        assert_eq!(h.from, h.to);
        assert_eq!(h.preview, "");
    }
    // Offsets of the two empty lines in the text: "a\n" | "\n" | "b\n" | "\n" | "c".
    assert_eq!(res.hits.iter().map(|h| h.from).collect::<Vec<_>>(), vec![2, 5]);
}

#[test]
fn trailing_newline_gives_one_empty_last_line() {
    // "a", "", "b" and the empty line after the final `\n` (a line in the Rope as well).
    let res = scan_with("a\n\nb\n", "^$", &ScanConfig::default());
    assert_eq!(lines(&res), vec![1, 3]);
    assert_eq!(res.hits[1].from, 5);
}

#[test]
fn zero_width_match_after_real_hit_is_not_a_second_hit() {
    // Line 0: `b` hits, the `$` before its `\n` must not add another hit for the line.
    let res = scan_with("ab\ncd", "b|$", &ScanConfig::default());
    assert_eq!(lines(&res), vec![0, 1]);
}

#[test]
fn zero_width_hits_do_not_duplicate_across_chunk_boundaries() {
    let text = "a\nb\n\nc\n";
    let reference = scan_with(text, "^", &ScanConfig::default());
    // Five lines: a, b, "", c and the empty last line.
    assert_eq!(lines(&reference), vec![0, 1, 2, 3, 4]);

    for read_size in 1..=text.len() + 1 {
        let cfg = ScanConfig { read_size, ..ScanConfig::default() };
        let res = scan_with(text, "^", &cfg);
        assert_eq!(res.hits, reference.hits, "read_size = {read_size}");
    }
}

// ── Result caps ────────────────────────────────────────────────

fn tree_with_needle_files(n: usize) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..n {
        std::fs::write(dir.path().join(format!("f{i}.txt")), "needle\n").unwrap();
    }
    dir
}

fn run_limited(root: &std::path::Path, mode: SearchMode, limits: Limits) -> (Vec<FileHit>, SearchSummary) {
    run_limited_for(root, mode, "needle", limits)
}

fn run_limited_for(root: &std::path::Path, mode: SearchMode, pattern: &str, limits: Limits) -> (Vec<FileHit>, SearchSummary) {
    let p = WorkspaceSearchParams {
        root: root.to_string_lossy().into_owned(),
        mode,
        search: params(pattern),
        include_ignored: false,
    };
    let re = build_regex(&p.search).unwrap();
    let collected: Mutex<Vec<FileHit>> = Mutex::new(Vec::new());
    let summary = walk::run_with_limits(&p, &re, &AtomicBool::new(false), &|b: SearchBatch| {
        collected.lock().unwrap().extend(b.files);
    }, limits);
    (collected.into_inner().unwrap(), summary)
}

#[test]
fn reaching_the_file_cap_exactly_is_not_truncation() {
    let dir = tree_with_needle_files(3);
    let (files, summary) = run_limited(dir.path(), SearchMode::Content, Limits { max_files: 3, max_hits: 100 });
    assert_eq!(files.len(), 3);
    assert_eq!(summary.hit_files, 3);
    assert!(!summary.truncated);
}

#[test]
fn a_hit_beyond_the_file_cap_is_truncation() {
    let dir = tree_with_needle_files(3);
    let (files, summary) = run_limited(dir.path(), SearchMode::Content, Limits { max_files: 2, max_hits: 100 });
    assert_eq!(files.len(), 2);
    assert_eq!(summary.hit_files, 2);
    assert!(summary.truncated);
}

#[test]
fn hit_line_cap_applies_to_content_only() {
    let dir = tree_with_needle_files(3);
    // Content: one hit line per file; budget of 1 is full after the first file.
    let (_, summary) = run_limited(dir.path(), SearchMode::Content, Limits { max_files: 10, max_hits: 1 });
    assert_eq!(summary.hit_files, 1);
    assert!(summary.truncated);

    // Name mode only counts files, `max_hits` is irrelevant.
    let (files, summary) = run_limited_for(dir.path(), SearchMode::Name, "txt", Limits { max_files: 10, max_hits: 0 });
    assert_eq!(files.len(), 3);
    assert!(!summary.truncated);
}
