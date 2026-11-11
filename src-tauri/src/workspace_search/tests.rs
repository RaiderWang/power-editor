use std::io::{BufReader, Cursor, Write};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use encoding_rs::{GBK, UTF_16LE, UTF_8};

use super::content::{scan_file, scan_reader, ScanConfig, ScanResult};
use super::types::{FileHit, SearchBatch, SearchMode, WorkspaceSearchParams};
use super::walk;
use crate::file_io::streaming::decode_stream_start;
use crate::search::{build_regex, SearchParams};

pub(super) fn params(pattern: &str) -> SearchParams {
    SearchParams {
        pattern: pattern.into(),
        is_regex: false,
        case_sensitive: true,
        whole_word: false,
    }
}

fn regex(pattern: &str) -> regex::Regex {
    build_regex(&params(pattern)).unwrap()
}

/// The Rope text the editor would hold for these bytes (same loader as `open_file`).
pub(super) fn editor_text(bytes: &[u8]) -> String {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    let reader = BufReader::new(std::fs::File::open(f.path()).unwrap());
    let (rope, ..) = decode_stream_start(reader, None).unwrap();
    rope.to_string()
}

fn scan_disk(bytes: &[u8], pattern: &str) -> ScanResult {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    scan_file(f.path(), &regex(pattern), &AtomicBool::new(false)).unwrap()
}

/// Every hit must point at the matched text in the editor's Rope coordinates.
fn assert_hits_match_rope(res: &ScanResult, rope_text: &str, needle: &str) {
    assert!(!res.hits.is_empty());
    for h in &res.hits {
        assert_eq!(&rope_text[h.from as usize..h.to as usize], needle);
        let line = rope_text[..h.from as usize].matches('\n').count() as u64;
        assert_eq!(h.line, line);
    }
}

#[test]
fn offsets_match_rope_for_utf8_bom_and_crlf_cjk() {
    let mut bytes = b"\xEF\xBB\xBF".to_vec();
    bytes.extend_from_slice("你好 needle\r\n第二行\r\nfoo needle 世界\r\n".as_bytes());
    let res = scan_disk(&bytes, "needle");
    assert_eq!(res.encoding, "UTF-8");
    let rope = editor_text(&bytes);
    assert_eq!(res.hits.len(), 2);
    assert_hits_match_rope(&res, &rope, "needle");
    assert_eq!(res.hits[0].line, 0);
    assert_eq!(res.hits[1].line, 2);
}

#[test]
fn lone_cr_line_endings_count_as_lines() {
    let bytes = b"one\rtwo needle\rthree\r";
    let res = scan_disk(bytes, "needle");
    let rope = editor_text(bytes);
    assert_hits_match_rope(&res, &rope, "needle");
    assert_eq!(res.hits[0].line, 1);
}

#[test]
fn chunk_boundaries_do_not_change_results() {
    let text = "alpha needle\r\n你好世界 needle 终\r\n\r\nplain\nneedle needle\rlast needle";
    let bytes = text.as_bytes();
    let rope = editor_text(bytes);
    let re = regex("needle");
    let cancel = AtomicBool::new(false);
    let reference = scan_reader(
        &mut Cursor::new(bytes),
        bytes.len() as u64,
        &re,
        &cancel,
        &ScanConfig::default(),
        Some(UTF_8),
    )
    .unwrap();
    assert_hits_match_rope(&reference, &rope, "needle");

    // Every small read size puts `\r` / `\r\n` / multi-byte chars on some boundary.
    for read_size in 1..=24 {
        let cfg = ScanConfig { read_size, ..ScanConfig::default() };
        let res = scan_reader(&mut Cursor::new(bytes), bytes.len() as u64, &re, &cancel, &cfg, Some(UTF_8)).unwrap();
        assert_eq!(res.hits, reference.hits, "read_size = {read_size}");
    }
}

#[test]
fn gbk_and_utf16_decode_across_chunks() {
    let text = "第一行 关键词\r\n第二行\r\n结尾 关键词 完";
    let re = regex("关键词");
    let cancel = AtomicBool::new(false);

    let (gbk, _, _) = GBK.encode(text);
    let mut utf16 = vec![0xFF, 0xFE];
    utf16.extend(text.encode_utf16().flat_map(|u| u.to_le_bytes()));

    for (bytes, enc) in [(gbk.to_vec(), GBK), (utf16, UTF_16LE)] {
        let whole = scan_reader(
            &mut Cursor::new(&bytes),
            bytes.len() as u64,
            &re,
            &cancel,
            &ScanConfig::default(),
            Some(enc),
        )
        .unwrap();
        assert_eq!(whole.hits.len(), 2, "{}", enc.name());
        let normalized = text.replace("\r\n", "\n");
        for h in &whole.hits {
            assert_eq!(&normalized[h.from as usize..h.to as usize], "关键词");
        }
        for read_size in 1..=13 {
            let cfg = ScanConfig { read_size, ..ScanConfig::default() };
            let res = scan_reader(&mut Cursor::new(&bytes), bytes.len() as u64, &re, &cancel, &cfg, Some(enc)).unwrap();
            assert_eq!(res.hits, whole.hits, "{} read_size = {read_size}", enc.name());
            assert!(res.hits.iter().all(|h| !h.preview.contains('\u{FFFD}')));
        }
    }
}

#[test]
fn single_huge_line_is_cut_safely() {
    let text = format!("{}needle{}", "界".repeat(40), "x".repeat(40));
    let bytes = text.as_bytes();
    let cfg = ScanConfig { read_size: 16, max_carry: 32, ..ScanConfig::default() };
    let res = scan_reader(
        &mut Cursor::new(bytes),
        bytes.len() as u64,
        &regex("x+"),
        &AtomicBool::new(false),
        &cfg,
        Some(UTF_8),
    )
    .unwrap();
    assert!(res.long_cuts > 0);
    for h in &res.hits {
        assert!(text.is_char_boundary(h.from as usize) && text.is_char_boundary(h.to as usize));
    }
}

#[test]
fn binary_files_are_skipped() {
    let res = scan_disk(b"text with \0 nul byte needle", "needle");
    assert!(res.binary);
    assert!(res.hits.is_empty());
}

#[test]
fn per_file_hit_cap_sets_more_and_one_hit_per_line() {
    let text = "needle needle\n".repeat(10);
    let cfg = ScanConfig { max_hits: 3, ..ScanConfig::default() };
    let res = scan_reader(
        &mut Cursor::new(text.as_bytes()),
        text.len() as u64,
        &regex("needle"),
        &AtomicBool::new(false),
        &cfg,
        None,
    )
    .unwrap();
    assert_eq!(res.hits.len(), 3);
    assert!(res.more);
    assert_eq!(res.hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![0, 1, 2]);
}

// ── Walk ───────────────────────────────────────────────────────

fn make_tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path();
    std::fs::create_dir_all(p.join("src")).unwrap();
    std::fs::create_dir_all(p.join("node_modules/pkg")).unwrap();
    std::fs::create_dir_all(p.join(".git")).unwrap();
    std::fs::write(p.join(".gitignore"), "ignored.txt\n").unwrap();
    std::fs::write(p.join("a.txt"), "hello needle\n").unwrap();
    std::fs::write(p.join("src/b.rs"), "fn main() {}\n// needle\n").unwrap();
    std::fs::write(p.join("ignored.txt"), "needle\n").unwrap();
    std::fs::write(p.join(".hidden"), "needle\n").unwrap();
    std::fs::write(p.join("node_modules/pkg/index.js"), "needle\n").unwrap();
    std::fs::write(p.join(".git/config"), "needle\n").unwrap();
    std::fs::write(p.join("bin.dat"), b"\0\0needle\0").unwrap();
    std::fs::write(p.join("pic.png"), "needle").unwrap();
    dir
}

fn run_search(root: &std::path::Path, mode: SearchMode, pattern: &str, include_ignored: bool) -> (Vec<FileHit>, super::types::SearchSummary) {
    let p = WorkspaceSearchParams {
        root: root.to_string_lossy().into_owned(),
        mode,
        search: SearchParams { case_sensitive: false, ..params(pattern) },
        include_ignored,
    };
    let re = build_regex(&p.search).unwrap();
    let collected: Mutex<Vec<FileHit>> = Mutex::new(Vec::new());
    let summary = walk::run(&p, &re, &AtomicBool::new(false), &|b: SearchBatch| {
        collected.lock().unwrap().extend(b.files);
    });
    let mut files = collected.into_inner().unwrap();
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    (files, summary)
}

#[test]
fn content_search_respects_ignore_rules_and_skips_binary() {
    let dir = make_tree();
    let (files, summary) = run_search(dir.path(), SearchMode::Content, "needle", false);
    let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(paths, vec!["a.txt", "src/b.rs"]);
    assert_eq!(files[1].hits[0].line, 1);
    assert!(summary.skipped_binary >= 2); // bin.dat (sniffed) + pic.png (extension)
    assert!(!summary.truncated && !summary.cancelled);

    let (files, _) = run_search(dir.path(), SearchMode::Content, "needle", true);
    let paths: Vec<_> = files.iter().map(|f| f.rel_path.as_str()).collect();
    // `.git` is never entered; everything else (hidden, ignored, node_modules) is.
    assert_eq!(
        paths,
        vec![".hidden", "a.txt", "ignored.txt", "node_modules/pkg/index.js", "src/b.rs"]
    );
}

#[test]
fn name_search_matches_basename_with_highlight() {
    let dir = make_tree();
    let (files, _) = run_search(dir.path(), SearchMode::Name, "B.R", false);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].rel_path, "src/b.rs");
    assert_eq!(files[0].name_hl, Some((0, 3)));
    assert!(files[0].hits.is_empty());
}

#[test]
fn cancelled_search_stops_immediately() {
    let dir = make_tree();
    let p = WorkspaceSearchParams {
        root: dir.path().to_string_lossy().into_owned(),
        mode: SearchMode::Content,
        search: params("needle"),
        include_ignored: false,
    };
    let re = build_regex(&p.search).unwrap();
    let summary = walk::run(&p, &re, &AtomicBool::new(true), &|_| {});
    assert!(summary.cancelled);
    assert_eq!(summary.scanned_files, 0);
}
