use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use ropey::Rope;

use super::*;
use crate::buffer::{Buffer, EditOp, LineEnding};

fn params(pattern: &str, is_regex: bool) -> SearchParams {
    SearchParams {
        pattern: pattern.into(),
        is_regex,
        case_sensitive: true,
        whole_word: false,
    }
}

/// Ground truth: one `Regex::replace_all` over the whole text.
fn expected(text: &str, p: &SearchParams, replacement: &str) -> (String, usize) {
    let re = build_regex(p).unwrap();
    let count = re.find_iter(text).count();
    let out = if p.is_regex {
        re.replace_all(text, replacement).into_owned()
    } else {
        re.replace_all(text, regex::NoExpand(replacement)).into_owned()
    };
    (out, count)
}

/// Tiny windows to exercise the boundary logic. The overlap must exceed the
/// longest match any test pattern can produce (about 16 bytes).
fn tiny_scan() -> ScanConfig {
    ScanConfig { window_size: 64, overlap: 24, single_window_max: 0 }
}

/// Every execution strategy that must agree with the ground truth.
fn variants() -> Vec<(&'static str, ReplaceOptions)> {
    let base = ReplaceOptions { scan: tiny_scan(), segment_target: 20, allow_parallel: false, max_workers: 1 };
    vec![
        ("default", ReplaceOptions::default()),
        ("sequential-tiny-windows", base),
        ("sequential-single-window", ReplaceOptions { scan: ScanConfig { single_window_max: usize::MAX, ..tiny_scan() }, ..base }),
        ("parallel-20", ReplaceOptions { allow_parallel: true, max_workers: 1, ..base }),
        ("parallel-33-x3", ReplaceOptions { allow_parallel: true, segment_target: 33, max_workers: 3, ..base }),
        ("parallel-100-x4", ReplaceOptions { allow_parallel: true, segment_target: 100, max_workers: 4, ..base }),
        (
            "parallel-small-segments-single-window",
            ReplaceOptions {
                scan: ScanConfig { single_window_max: usize::MAX, ..tiny_scan() },
                allow_parallel: true,
                segment_target: 40,
                max_workers: 4,
            },
        ),
    ]
}

fn assert_all_variants(text: &str, p: &SearchParams, replacement: &str) {
    let (want, want_count) = expected(text, p, replacement);
    let rope = Rope::from_str(text);
    for (name, opts) in variants() {
        let ctl = ReplaceControl::silent(rope.len_bytes() as u64);
        let (got, count) = compute_with(&rope, p, replacement, &ctl, &opts)
            .unwrap()
            .expect("not cancelled");
        assert_eq!(count, want_count, "{name}: count for {:?} -> {:?}", p.pattern, replacement);
        assert_eq!(got.to_string(), want, "{name}: text for {:?} -> {:?}", p.pattern, replacement);
        // The source rope is never modified.
        assert_eq!(rope.to_string(), text, "{name}: source rope changed");
    }
}

fn sample_text() -> String {
    "héllo wörld 你好世界 abc foo\nfoo bar baz foo\n\n  indented line 12 and 345\nqux 你好 foo, FOO\n".repeat(30)
}

#[test]
fn literal_patterns_agree_with_whole_text_replace() {
    let text = sample_text();
    for (pat, rep) in [("foo", "FOO!"), ("你好", "x"), ("o", ""), ("foo bar", "a\nb"), ("\n\n", "\n")] {
        assert_all_variants(&text, &params(pat, false), rep);
    }
}

#[test]
fn literal_mode_keeps_dollar_signs_verbatim() {
    let text = sample_text();
    for rep in ["$1", "${x}", "$$", "a$b"] {
        assert_all_variants(&text, &params("foo", false), rep);
    }
}

#[test]
fn regex_patterns_including_zero_width_agree_with_whole_text_replace() {
    let text = sample_text();
    for (pat, rep) in [
        (r"\d+", "<$0>"),
        (r"(\w+) (\w+)", "$2 $1"),
        (r"a*", "X"),
        (r"x*", "-"),
        (r"(?m)^", "> "),
        (r"^", "> "),
        (r"(?m)$", ";"),
        (r"$", ";"),
        (r"\B", "|"),
        (r"\b", "|"),
        (r"(?m)^\s*$", "EMPTY"),
        (r"\s+", " "),
        (r"[^a-z]+", "_"),
        (r"(?s)o.b", "OB"),
        (r"\w+", "W"),
        (r"(?m)^\w+", "L"),
        (r"(?m)\w+$", "R"),
        (r"foo|FOO", "${0}${0}"),
        (r"(\d)(\d)", "$2$1"),
    ] {
        assert_all_variants(&text, &params(pat, true), rep);
    }
}

#[test]
fn dollar_forms_in_regex_replacement_match_regex_crate_semantics() {
    let text = sample_text();
    for rep in ["$$", "$0", "$foo", "${1}x", "$1$2", "$$1", "cost: $"] {
        assert_all_variants(&text, &params(r"(f)(o+)", true), rep);
    }
}

#[test]
fn text_level_anchors_stay_correct_via_sequential_path() {
    let text = sample_text();
    for (pat, rep) in [(r"\Ahéllo", "START"), (r"foo, FOO\n\z", "END"), (r"\A", "<"), (r"\z", ">")] {
        assert_all_variants(&text, &params(pat, true), rep);
    }
}

#[test]
fn case_insensitive_and_whole_word() {
    let text = sample_text();
    let mut p = params("foo", false);
    p.case_sensitive = false;
    assert_all_variants(&text, &p, "bar");
    p.whole_word = true;
    assert_all_variants(&text, &p, "bar");
    let mut p = params(r"fo+", true);
    p.whole_word = true;
    assert_all_variants(&text, &p, "<$0>");
}

#[test]
fn matches_at_segment_and_window_boundaries() {
    // Matches placed at every possible offset around the tiny boundaries.
    for pad in 0..60 {
        let text = format!("{}foo\nfoo{}\nfoo\n", "x".repeat(pad), "y".repeat(pad));
        assert_all_variants(&text, &params("foo", false), "[bar]");
        assert_all_variants(&text, &params(r"(?m)^", true), "#");
        assert_all_variants(&text, &params(r"(?m)$", true), ";");
    }
}

#[test]
fn text_without_trailing_newline_and_tiny_inputs() {
    for text in ["", "a", "foo", "foo\n", "\n", "\n\n\n", "a\nb", "你"] {
        for (pat, rep, rx) in [("a", "b", false), ("a*", "X", true), (r"(?m)^", ">", true), (r"(?m)$", "<", true), ("", "-", false)] {
            assert_all_variants(text, &params(pat, rx), rep);
        }
    }
}

#[test]
fn very_long_single_line_does_not_stall() {
    let text = format!("{}\nshort foo\n{}\n", "ab ".repeat(500), "foo ".repeat(400));
    assert_all_variants(&text, &params("foo", false), "FOOBAR");
    assert_all_variants(&text, &params(r"b\s", true), "B_");
}

#[test]
fn dense_matches_across_many_default_sized_segments() {
    let line = "id=123 name=abc value=4567 foo\n";
    let text = line.repeat(80_000); // ~2.4 MB
    let p = params(r"\d+", true);
    let (want, want_count) = expected(&text, &p, "N");
    let rope = Rope::from_str(&text);
    for opts in [
        ReplaceOptions { segment_target: 64 * 1024, ..ReplaceOptions::default() },
        ReplaceOptions { allow_parallel: false, ..ReplaceOptions::default() },
    ] {
        let ctl = ReplaceControl::silent(rope.len_bytes() as u64);
        let (got, count) = compute_with(&rope, &p, "N", &ctl, &opts).unwrap().unwrap();
        assert_eq!(count, want_count);
        assert!(got.to_string() == want);
    }
}

#[test]
fn no_match_returns_the_original_rope() {
    let rope = Rope::from_str(&sample_text());
    for (_, opts) in variants() {
        let ctl = ReplaceControl::silent(rope.len_bytes() as u64);
        let (got, count) = compute_with(&rope, &params("zzzz", false), "1", &ctl, &opts).unwrap().unwrap();
        assert_eq!(count, 0);
        assert_eq!(got.to_string(), rope.to_string());
    }
}

#[test]
fn invalid_regex_is_an_error() {
    let rope = Rope::from_str("abc");
    let ctl = ReplaceControl::silent(3);
    assert!(compute(&rope, &params("(", true), "x", &ctl).is_err());
}

fn registry_with(text: &str) -> (BufferRegistry, u64) {
    let registry = BufferRegistry::new();
    let id = BufferRegistry::next_id();
    registry.insert(Buffer::from_rope(id, Rope::from_str(text), None, "UTF-8".into(), LineEnding::Lf));
    (registry, id)
}

fn cancelled_control(total: u64) -> ReplaceControl {
    ReplaceControl::new(Arc::new(AtomicBool::new(true)), total, None)
}

#[test]
fn cancelled_run_leaves_buffer_and_snapshots_untouched() {
    let text = sample_text();
    let (registry, id) = registry_with(&text);
    assert!(run(&registry, id, &params("foo", false), "X", cancelled_control).unwrap().is_none());

    let mut buffers = registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&id).unwrap();
    assert_eq!(buf.get_full_text(), text);
    assert!(!buf.is_modified);
    assert!(!buf.undo_replace_all(), "no snapshot was taken");
}

#[test]
fn cancel_in_parallel_mode_returns_none() {
    let rope = Rope::from_str(&sample_text());
    let opts = ReplaceOptions { scan: tiny_scan(), segment_target: 30, allow_parallel: true, max_workers: 3 };
    let ctl = cancelled_control(rope.len_bytes() as u64);
    assert!(compute_with(&rope, &params("foo", false), "X", &ctl, &opts).unwrap().is_none());
}

#[test]
fn commit_is_refused_when_the_text_changed_meanwhile() {
    let (registry, id) = registry_with("one two one");
    let prepared = prepare(&registry, id).unwrap();
    let ctl = ReplaceControl::silent(11);
    let (new_rope, count) = compute(&prepared.rope, &params("one", false), "1", &ctl).unwrap().unwrap();
    assert_eq!(count, 2);

    // A real edit lands while the background job was running.
    {
        let mut buffers = registry.buffers.lock().unwrap();
        buffers.get_mut(&id).unwrap().apply_edit(&EditOp { from: 0, to: 0, text: "x".into() }).unwrap();
    }
    assert!(commit(&registry, id, prepared.revision, new_rope).is_err());

    let buffers = registry.buffers.lock().unwrap();
    assert_eq!(buffers.get(&id).unwrap().get_full_text(), "xone two one");
}

#[test]
fn noop_edit_does_not_invalidate_a_running_job() {
    let (registry, id) = registry_with("one two one");
    let prepared = prepare(&registry, id).unwrap();
    {
        let mut buffers = registry.buffers.lock().unwrap();
        // Same text written back: not a real edit, revision stays.
        buffers
            .get_mut(&id)
            .unwrap()
            .apply_edit(&EditOp { from: 0, to: usize::MAX, text: "one two one".into() })
            .unwrap();
    }
    let ctl = ReplaceControl::silent(11);
    let (new_rope, _) = compute(&prepared.rope, &params("one", false), "1", &ctl).unwrap().unwrap();
    assert!(commit(&registry, id, prepared.revision, new_rope).is_ok());
}

#[test]
fn outcome_reports_updated_file_info_and_undo_redo_adjust_it() {
    let (registry, id) = registry_with("a X b\nX c");
    {
        let mut buffers = registry.buffers.lock().unwrap();
        // Pretend the file was loaded from a 9-byte file on disk.
        buffers.get_mut(&id).unwrap().file_total_bytes = 9;
    }
    let out = run(&registry, id, &params("X", false), "LONGER\nTEXT", ReplaceControl::silent)
        .unwrap()
        .unwrap();
    assert_eq!(out.count, 2);
    assert_eq!(out.file_info.total_lines, 4);
    assert_eq!(out.file_info.total_bytes, 9 + 2 * ("LONGER\nTEXT".len() as u64 - 1));
    assert!(out.file_info.is_modified);

    let mut buffers = registry.buffers.lock().unwrap();
    let buf = buffers.get_mut(&id).unwrap();
    assert!(buf.undo_replace_all());
    assert_eq!(buf.file_info().total_bytes, 9);
    assert!(buf.redo_replace_all());
    assert_eq!(buf.file_info().total_bytes, out.file_info.total_bytes);
}

#[test]
fn zero_matches_commit_nothing() {
    let (registry, id) = registry_with("abc");
    let out = run(&registry, id, &params("zzz", false), "1", ReplaceControl::silent)
        .unwrap()
        .unwrap();
    assert_eq!(out.count, 0);
    assert!(!out.file_info.is_modified);
    let mut buffers = registry.buffers.lock().unwrap();
    assert!(!buffers.get_mut(&id).unwrap().undo_replace_all());
}

#[test]
fn progress_reaches_total_and_counts_matches() {
    use std::sync::Mutex;
    let text = sample_text();
    let rope = Rope::from_str(&text);
    let seen: Arc<Mutex<Vec<progress::ProgressSnapshot>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let ctl = ReplaceControl::new(
        Arc::new(AtomicBool::new(false)),
        text.len() as u64,
        Some(Box::new(move |s| sink.lock().unwrap().push(s))),
    );
    let opts = ReplaceOptions { scan: tiny_scan(), segment_target: 50, allow_parallel: true, max_workers: 2 };
    let (_, count) = compute_with(&rope, &params("foo", false), "X", &ctl, &opts).unwrap().unwrap();
    ctl.finish();

    let snap = ctl.snapshot();
    assert_eq!(snap.bytes_done, text.len() as u64);
    assert_eq!(snap.matches as usize, count);
    let last = *seen.lock().unwrap().last().expect("final report emitted");
    assert_eq!(last.bytes_done, last.total_bytes);
    assert!(!ctl.is_cancelled() && ctl.snapshot().total_bytes == text.len() as u64);
}
