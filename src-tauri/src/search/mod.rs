use anyhow::{anyhow, Result};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::buffer::BufferRegistry;
#[cfg(test)]
use scan::find_char_boundary;

pub mod eligibility;
pub mod replace;
pub mod scan;

pub use replace::replace_all;

/// Files larger than this use windowed search instead of full-text materialisation.
const SEARCH_WINDOW_THRESHOLD: usize = 200 * 1024 * 1024; // 200 MB

/// Parameters for a find/replace operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchParams {
    pub pattern: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

/// A single match result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    /// Byte offset in the normalized (LF) document
    pub from: usize,
    pub to: usize,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

/// Result summary from a find operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindResult {
    pub matches: Vec<SearchMatch>,
    pub total: usize,
    pub truncated: bool,
}

/// The final regex source for `params` (escaping, whole-word wrapping).
/// Shared with `eligibility`, which must analyse exactly what gets compiled.
pub(crate) fn build_pattern(params: &SearchParams) -> String {
    let pattern = if params.is_regex {
        params.pattern.clone()
    } else {
        regex::escape(&params.pattern)
    };

    if params.whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    }
}

/// Build a Regex from SearchParams.
///
/// `multi_line` is on: `^` / `$` match at line starts / ends like in other
/// editors; use `\A` / `\z` for the start / end of the whole document.
pub(crate) fn build_regex(params: &SearchParams) -> Result<Regex> {
    let re = RegexBuilder::new(&build_pattern(params))
        .case_insensitive(!params.case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|e| anyhow!("Invalid regex: {}", e))?;

    Ok(re)
}

// ──────────────────────────────────────────────────────────────
// Match metadata helpers
// ──────────────────────────────────────────────────────────────

/// Build a `SearchMatch` from an absolute byte range, using the rope for
/// line/column look-up and `text_slice` (a string covering that region) for
/// the line preview.
fn build_match(
    rope: &ropey::Rope,
    text_slice: &str,
    text_slice_byte_start: usize,
    from: usize,
    to: usize,
) -> SearchMatch {
    let char_idx = rope.byte_to_char(from);
    let line = rope.char_to_line(char_idx);
    let line_start_char = rope.line_to_char(line);
    let line_start_byte = rope.char_to_byte(line_start_char);
    let column = from - line_start_byte;

    let line_end_char = if line + 1 < rope.len_lines() {
        rope.line_to_char(line + 1) - 1
    } else {
        rope.len_chars()
    };
    let line_end_byte = rope.char_to_byte(line_end_char);

    // Extract the line preview from the provided text slice.
    let preview = if line_start_byte >= text_slice_byte_start
        && line_end_byte <= text_slice_byte_start + text_slice.len()
    {
        let rel_start = line_start_byte - text_slice_byte_start;
        let rel_end = line_end_byte - text_slice_byte_start;
        text_slice[rel_start..rel_end].chars().take(200).collect()
    } else {
        // Fallback: extract directly from rope (rare edge case at window boundary)
        let slice = rope.slice(line_start_char..line_end_char);
        slice.chars().take(200).collect()
    };

    SearchMatch {
        from,
        to,
        line,
        column,
        preview,
    }
}

// ──────────────────────────────────────────────────────────────
// find_all – full-text path (files ≤ threshold)
// ──────────────────────────────────────────────────────────────

fn find_all_full(
    rope: &ropey::Rope,
    re: &Regex,
    max_results: usize,
) -> FindResult {
    let text = rope.to_string();
    let mut matches = Vec::new();
    let mut total = 0;

    for m in re.find_iter(&text) {
        total += 1;
        if matches.len() < max_results {
            matches.push(build_match(rope, &text, 0, m.start(), m.end()));
        }
    }

    FindResult {
        truncated: total > max_results,
        total,
        matches,
    }
}

// ──────────────────────────────────────────────────────────────
// find_all – windowed path (files > threshold)
// ──────────────────────────────────────────────────────────────

/// Collects `SearchMatch`es from the shared window scanner (`scan::scan_rope`).
struct FindSink<'a> {
    rope: &'a ropey::Rope,
    matches: Vec<SearchMatch>,
    total: usize,
    max_results: usize,
}

impl scan::MatchSink for FindSink<'_> {
    fn on_match(&mut self, win: &scan::Window, start: usize, end: usize, _caps: Option<&regex::Captures>) {
        self.total += 1;
        if self.matches.len() < self.max_results {
            self.matches.push(build_match(
                self.rope,
                win.text,
                win.abs_start,
                win.abs_start + start,
                win.abs_start + end,
            ));
        }
    }

    fn flush(&mut self, _win: &scan::Window, _upto: usize) {}
}

fn find_all_windowed(
    rope: &ropey::Rope,
    re: &Regex,
    max_results: usize,
    cfg: &scan::ScanConfig,
) -> FindResult {
    let mut sink = FindSink {
        rope,
        matches: Vec::new(),
        total: 0,
        max_results,
    };
    let mut buf = String::new();
    // `NoControl` never cancels, so the scan always completes.
    let _ = scan::scan_rope(
        rope,
        true,
        re,
        false,
        &mut sink,
        &scan::NoControl,
        cfg,
        &mut buf,
    );

    FindResult {
        truncated: sink.total > max_results,
        total: sink.total,
        matches: sink.matches,
    }
}

// ──────────────────────────────────────────────────────────────
// Public find_all entry point
// ──────────────────────────────────────────────────────────────

pub fn find_all(
    registry: &BufferRegistry,
    buffer_id: u64,
    params: &SearchParams,
    max_results: usize,
) -> Result<FindResult> {
    // `Rope::clone` is an O(1) copy-on-write share: take it under the lock and
    // scan without holding the registry mutex.
    let rope = {
        let buffers = registry.buffers.lock().unwrap();
        buffers
            .get(&buffer_id)
            .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?
            .rope
            .clone()
    };

    let re = build_regex(params)?;

    if rope.len_bytes() <= SEARCH_WINDOW_THRESHOLD {
        Ok(find_all_full(&rope, &re, max_results))
    } else {
        Ok(find_all_windowed(&rope, &re, max_results, &scan::ScanConfig::default()))
    }
}

/// Replace a single match by byte range
pub fn replace_one(
    registry: &BufferRegistry,
    buffer_id: u64,
    from: usize,
    to: usize,
    replacement: &str,
) -> Result<()> {
    let mut buffers = registry.buffers.lock().unwrap();
    let buffer = buffers
        .get_mut(&buffer_id)
        .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;
    buffer.ensure_replaceable().map_err(|e| anyhow!(e))?;
    buffer.invalidate_replace_snapshots();

    let from_char = buffer.rope.byte_to_char(from.min(buffer.rope.len_bytes()));
    let to_char = buffer.rope.byte_to_char(to.min(buffer.rope.len_bytes()));

    if from_char < to_char {
        buffer.rope.remove(from_char..to_char);
    }
    if !replacement.is_empty() {
        buffer.rope.insert(from_char, replacement);
    }
    buffer.is_modified = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{Buffer, LineEnding};
    use ropey::Rope;

    fn make_registry_with(text: &str) -> (BufferRegistry, u64) {
        let registry = BufferRegistry::new();
        let id = BufferRegistry::next_id();
        let buf = Buffer::from_rope(id, Rope::from_str(text), None, "UTF-8".into(), LineEnding::Lf);
        registry.insert(buf);
        (registry, id)
    }

    #[test]
    fn test_build_regex_literal_escaping() {
        let params = SearchParams {
            pattern: "foo.bar".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let re = build_regex(&params).unwrap();
        assert!(re.is_match("foo.bar"));
        assert!(!re.is_match("fooXbar"));
    }

    #[test]
    fn test_build_regex_whole_word() {
        let params = SearchParams {
            pattern: "is".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: true,
        };
        let re = build_regex(&params).unwrap();
        let matches: Vec<&str> = re.find_iter("this is a test").map(|m| m.as_str()).collect();
        assert_eq!(matches, vec!["is"]);
    }

    #[test]
    fn test_build_regex_case_insensitive() {
        let params = SearchParams {
            pattern: "Hello".into(),
            is_regex: false,
            case_sensitive: false,
            whole_word: false,
        };
        let re = build_regex(&params).unwrap();
        assert!(re.is_match("hello"));
        assert!(re.is_match("HELLO"));
        assert!(re.is_match("HeLLo"));
    }

    #[test]
    fn test_build_regex_anchors_are_line_anchors() {
        let params = SearchParams {
            pattern: r"^\w+$".into(),
            is_regex: true,
            case_sensitive: true,
            whole_word: false,
        };
        let re = build_regex(&params).unwrap();
        let found: Vec<&str> = re.find_iter("one\ntwo three\nfour").map(|m| m.as_str()).collect();
        assert_eq!(found, vec!["one", "four"]);

        // `\A` / `\z` still anchor the whole document.
        let doc = SearchParams { pattern: r"\Aone".into(), ..params.clone() };
        let re = build_regex(&doc).unwrap();
        assert_eq!(re.find_iter("one\none").count(), 1);
    }

    #[test]
    fn test_find_all_windowed_matches_full_text_results() {
        // Windowed scanning (used > 200 MB) must agree with the full-text path.
        let text = "héllo foo\nfoo 你好 foo\n".repeat(500);
        let rope = Rope::from_str(&text);
        let re = RegexBuilder::new(r"(?m)^foo|你好|foo$").multi_line(true).build().unwrap();
        let full = find_all_full(&rope, &re, 100_000);
        // Tiny windows (and `single_window_max: 0`) so the multi-window path of
        // `FindSink` / `build_match` is really exercised, not the single-window one.
        let cfg = scan::ScanConfig { window_size: 64, overlap: 24, single_window_max: 0 };
        let windowed = find_all_windowed(&rope, &re, 100_000, &cfg);
        assert_eq!(windowed.total, full.total);
        let pos = |r: &FindResult| {
            r.matches
                .iter()
                .map(|m| (m.from, m.to, m.line, m.column, m.preview.clone()))
                .collect::<Vec<_>>()
        };
        assert_eq!(pos(&windowed), pos(&full));
    }

    #[test]
    fn test_build_regex_valid_regex_pattern() {
        let params = SearchParams {
            pattern: r"\d{3}-\d{4}".into(),
            is_regex: true,
            case_sensitive: true,
            whole_word: false,
        };
        let re = build_regex(&params).unwrap();
        assert!(re.is_match("tel: 123-4567"));
        assert!(!re.is_match("tel: 12-4567"));
    }

    #[test]
    fn test_find_all_full_ascii_offsets() {
        let rope = Rope::from_str("foo bar foo");
        let re = Regex::new("foo").unwrap();
        let res = find_all_full(&rope, &re, 100);
        assert_eq!(res.total, 2);
        assert_eq!(res.matches.len(), 2);
        assert!(!res.truncated);

        assert_eq!(res.matches[0].from, 0);
        assert_eq!(res.matches[0].to, 3);
        assert_eq!(res.matches[0].line, 0);
        assert_eq!(res.matches[0].column, 0);

        assert_eq!(res.matches[1].from, 8);
        assert_eq!(res.matches[1].to, 11);
        assert_eq!(res.matches[1].line, 0);
        assert_eq!(res.matches[1].column, 8);
    }

    #[test]
    fn test_find_all_full_cjk_search_ascii() {
        // "你好" is 6 bytes in UTF-8
        let rope = Rope::from_str("你好world你好");
        let re = Regex::new("world").unwrap();
        let res = find_all_full(&rope, &re, 100);
        assert_eq!(res.total, 1);
        assert_eq!(res.matches[0].from, 6);
        assert_eq!(res.matches[0].to, 11);
    }

    #[test]
    fn test_find_all_full_cjk_search_cjk() {
        // "abc" (3) + "你好" (6) + "def" (3)
        let rope = Rope::from_str("abc你好def");
        let re = Regex::new("你好").unwrap();
        let res = find_all_full(&rope, &re, 100);
        assert_eq!(res.total, 1);
        assert_eq!(res.matches[0].from, 3);
        assert_eq!(res.matches[0].to, 9);
    }

    #[test]
    fn test_find_all_full_line_and_column() {
        // Line 0: "first line\n" (11 bytes)
        // Line 1: "你好world\n"  (6 bytes CJK + 5 bytes ASCII + 1 byte '\n' = 12 bytes)
        let rope = Rope::from_str("first line\n你好world\n");
        let re = Regex::new("world").unwrap();
        let res = find_all_full(&rope, &re, 100);
        assert_eq!(res.total, 1);
        let m = &res.matches[0];
        assert_eq!(m.line, 1);
        assert_eq!(m.from, 17);
        assert_eq!(m.to, 22);
        assert_eq!(m.column, 6); // 17 - 11 = 6 byte column
        assert_eq!(m.preview, "你好world");
    }

    #[test]
    fn test_find_all_full_truncation() {
        let text = "item item item item item item item item item item"; // 10 items
        let rope = Rope::from_str(text);
        let re = Regex::new("item").unwrap();
        let res = find_all_full(&rope, &re, 4);
        assert_eq!(res.total, 10);
        assert_eq!(res.matches.len(), 4);
        assert!(res.truncated);
    }

    #[test]
    fn test_find_all_full_no_match() {
        let rope = Rope::from_str("abcdefg");
        let re = Regex::new("xyz").unwrap();
        let res = find_all_full(&rope, &re, 100);
        assert_eq!(res.total, 0);
        assert!(res.matches.is_empty());
        assert!(!res.truncated);
    }

    #[test]
    fn test_find_char_boundary() {
        let s = "你好"; // 6 bytes: [0..3] = '你', [3..6] = '好'
        assert_eq!(find_char_boundary(s, 0), 0);
        assert_eq!(find_char_boundary(s, 1), 0); // mid-char '你' -> back to 0
        assert_eq!(find_char_boundary(s, 2), 0); // mid-char '你' -> back to 0
        assert_eq!(find_char_boundary(s, 3), 3); // exact boundary between '你' and '好'
        assert_eq!(find_char_boundary(s, 4), 3); // mid-char '好' -> back to 3
        assert_eq!(find_char_boundary(s, 5), 3); // mid-char '好' -> back to 3
        assert_eq!(find_char_boundary(s, 6), 6); // exact end
        assert_eq!(find_char_boundary(s, 100), 6); // >= len -> returns len
    }

    #[test]
    fn test_replace_all_basic() {
        let (registry, id) = make_registry_with("aaa bbb aaa");
        let params = SearchParams {
            pattern: "aaa".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let count = replace_all(&registry, id, &params, "XXX").unwrap();
        assert_eq!(count, 2);
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(buffers.get(&id).unwrap().get_full_text(), "XXX bbb XXX");
    }

    #[test]
    fn test_replace_all_reverse_order_preserves_offsets() {
        // Replacing with text of different length:
        // Reverse application ensures earlier replacement offsets are not corrupted
        let (registry, id) = make_registry_with("a X b X c");
        let params = SearchParams {
            pattern: "X".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let count = replace_all(&registry, id, &params, "LONG_REPLACEMENT").unwrap();
        assert_eq!(count, 2);
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(
            buffers.get(&id).unwrap().get_full_text(),
            "a LONG_REPLACEMENT b LONG_REPLACEMENT c"
        );
    }

    #[test]
    fn test_replace_all_capture_groups() {
        let (registry, id) = make_registry_with("hello-world and foo-bar");
        let params = SearchParams {
            pattern: r"(\w+)-(\w+)".into(),
            is_regex: true,
            case_sensitive: true,
            whole_word: false,
        };
        let count = replace_all(&registry, id, &params, "$2-$1").unwrap();
        assert_eq!(count, 2);
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(buffers.get(&id).unwrap().get_full_text(), "world-hello and bar-foo");
    }

    #[test]
    fn test_replace_all_plain_mode_keeps_dollar_literal() {
        // Non-regex mode must not interpret `$` / `${...}` in the replacement.
        let (registry, id) = make_registry_with("echo ${tag} and ${tag}");
        let params = SearchParams {
            pattern: "${tag}".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let count = replace_all(&registry, id, &params, "${tag[i]}").unwrap();
        assert_eq!(count, 2);
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(
            buffers.get(&id).unwrap().get_full_text(),
            "echo ${tag[i]} and ${tag[i]}"
        );
    }

    #[test]
    fn test_replace_all_cjk() {
        let (registry, id) = make_registry_with("你好世界，美丽的地球世界");
        let params = SearchParams {
            pattern: "世界".into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let count = replace_all(&registry, id, &params, "家园").unwrap();
        assert_eq!(count, 2);
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(buffers.get(&id).unwrap().get_full_text(), "你好家园，美丽的地球家园");
    }

    fn plain_params(pattern: &str) -> SearchParams {
        SearchParams {
            pattern: pattern.into(),
            is_regex: false,
            case_sensitive: true,
            whole_word: false,
        }
    }

    #[test]
    fn test_replace_all_undo_redo_roundtrip() {
        let (registry, id) = make_registry_with("a X b\nX c X");
        assert_eq!(replace_all(&registry, id, &plain_params("X"), "YY\nY").unwrap(), 3);
        let mut buffers = registry.buffers.lock().unwrap();
        let buf = buffers.get_mut(&id).unwrap();
        assert_eq!(buf.get_full_text(), "a YY\nY b\nYY\nY c YY\nY");

        assert!(buf.undo_replace_all());
        assert_eq!(buf.get_full_text(), "a X b\nX c X");
        assert!(!buf.undo_replace_all(), "only one level of undo");

        assert!(buf.redo_replace_all());
        assert_eq!(buf.get_full_text(), "a YY\nY b\nYY\nY c YY\nY");
        assert!(!buf.redo_replace_all());
        assert!(buf.undo_replace_all());
        assert_eq!(buf.get_full_text(), "a X b\nX c X");
    }

    #[test]
    fn test_replace_all_without_match_keeps_previous_snapshot_state() {
        let (registry, id) = make_registry_with("abc");
        assert_eq!(replace_all(&registry, id, &plain_params("zzz"), "1").unwrap(), 0);
        let mut buffers = registry.buffers.lock().unwrap();
        assert!(!buffers.get_mut(&id).unwrap().undo_replace_all());
    }

    #[test]
    fn test_snapshots_invalidated_by_real_edit_but_not_by_noop_edit() {
        use crate::buffer::EditOp;
        let (registry, id) = make_registry_with("one two one");
        replace_all(&registry, id, &plain_params("one"), "1").unwrap();
        let mut buffers = registry.buffers.lock().unwrap();
        let buf = buffers.get_mut(&id).unwrap();

        // Writing back identical text (typed char that was undone) keeps the snapshot.
        buf.apply_edit(&EditOp { from: 0, to: usize::MAX, text: "1 two 1".into() }).unwrap();
        assert!(buf.replace_undo.is_some());

        // A real edit drops it.
        buf.apply_edit(&EditOp { from: 0, to: 0, text: "x".into() }).unwrap();
        assert!(buf.replace_undo.is_none() && buf.replace_redo.is_none());
        assert!(!buf.undo_replace_all());
    }

    #[test]
    fn test_replace_one_invalidates_snapshots() {
        let (registry, id) = make_registry_with("a a a");
        replace_all(&registry, id, &plain_params("a"), "b").unwrap();
        replace_one(&registry, id, 0, 1, "c").unwrap();
        let mut buffers = registry.buffers.lock().unwrap();
        assert!(!buffers.get_mut(&id).unwrap().undo_replace_all());
    }

    #[test]
    fn test_replace_refused_when_read_only_or_still_loading() {
        let (registry, id) = make_registry_with("a a");
        {
            let mut buffers = registry.buffers.lock().unwrap();
            buffers.get_mut(&id).unwrap().is_read_only = true;
        }
        assert!(replace_all(&registry, id, &plain_params("a"), "b").is_err());
        assert!(replace_one(&registry, id, 0, 1, "b").is_err());
        {
            let mut buffers = registry.buffers.lock().unwrap();
            let buf = buffers.get_mut(&id).unwrap();
            buf.is_read_only = false;
            buf.is_fully_loaded = false;
        }
        assert!(replace_all(&registry, id, &plain_params("a"), "b").is_err());
        let buffers = registry.buffers.lock().unwrap();
        assert_eq!(buffers.get(&id).unwrap().get_full_text(), "a a");
    }
}

