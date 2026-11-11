//! Windowed regex scanning over a `Rope`, shared by `find_all` (large files) and
//! Replace All.
//!
//! The rope is streamed through a reusable `String` window. Invariants that make
//! the result identical to one single `find_iter` over the whole text:
//!
//! * **Ownership / `cut`**: a match belongs to the window in which its *start* lies
//!   before `safe_end` (the final window owns everything). The next window begins
//!   searching at `cut = max(safe_end, end of last match)`, so no match is handled
//!   twice or overlaps another. `safe_end` is aligned to a UTF-8 char boundary
//!   *before* scanning.
//! * **Context**: the next window keeps one char before `cut` and searches with
//!   `find_at` / `captures_at` from `cut`, so `\A`, `(?m)^`, `\b`, `\B` see the real
//!   previous character instead of a fake start of text. The "previous match ended
//!   here" state is carried across windows to reject overlapping empty matches the
//!   same way `Regex::find_iter` does.
//! * **Non-final windows** can only see a fake EOF at `window.len() >= safe_end`,
//!   where matches are not owned, so `\z` / `(?m)$` cannot misfire.
//! * **Parallel segments** (`is_last_segment == false`) end with `\n`. For patterns
//!   that cannot match `\n` (see `eligibility`) every match with
//!   `start < seg.len()` ends before that `\n`, so look-ahead sees the real
//!   newline. The only match touching `seg.len()` is a zero-width one at the fake
//!   EOF; it belongs to the next segment (offset 0) and is dropped here.
//!
//! Known limit: a single match longer than the window overlap (1 MB) is not
//! guaranteed to be found whole.

use regex::{Captures, Regex};
use ropey::Rope;

/// Tunables of the window scanner. Production code uses `Default`; tests shrink
/// the values to exercise the boundary logic with tiny inputs.
#[derive(Debug, Clone, Copy)]
pub struct ScanConfig {
    /// Size at which a (non-final) window is processed.
    pub window_size: usize,
    /// Tail kept unprocessed so boundary-spanning matches are seen whole.
    pub overlap: usize,
    /// Ropes up to this size are scanned as a single window.
    pub single_window_max: usize,
}

impl Default for ScanConfig {
    fn default() -> Self {
        ScanConfig {
            window_size: 4 * 1024 * 1024,
            overlap: 1024 * 1024,
            single_window_max: 64 * 1024 * 1024,
        }
    }
}

/// Returned when the scan was stopped by the cancel flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

/// Progress / cancellation hooks used by the scanner.
pub trait ScanControl: Sync {
    fn is_cancelled(&self) -> bool;
    /// `n` more source bytes were fully processed.
    fn add_done(&self, n: usize);
    /// `n` more matches were found.
    fn add_matches(&self, n: usize);
}

/// A `ScanControl` that never cancels and ignores progress.
pub struct NoControl;

impl ScanControl for NoControl {
    fn is_cancelled(&self) -> bool {
        false
    }
    fn add_done(&self, _n: usize) {}
    fn add_matches(&self, _n: usize) {}
}

/// The text currently being scanned and where it sits in the rope.
pub struct Window<'a> {
    pub text: &'a str,
    /// Absolute byte offset of `text[0]` in the scanned rope.
    pub abs_start: usize,
}

/// Receives matches from `scan_rope`. All offsets are relative to `win.text`.
pub trait MatchSink {
    /// A match owned by the current window. `caps` is `Some` only when the scan
    /// was started with `need_caps = true`.
    fn on_match(&mut self, win: &Window, start: usize, end: usize, caps: Option<&Captures>);
    /// The scan is done with `win.text[..upto]`: everything before `upto` that was
    /// not part of a match is final and must be emitted now (the window prefix is
    /// dropped afterwards).
    fn flush(&mut self, win: &Window, upto: usize);
}

/// Matches are checked for cancellation every `CANCEL_CHECK_MASK + 1` hits.
const CANCEL_CHECK_MASK: usize = 0xFFF;

/// Largest byte index <= `target` that is a valid UTF-8 char boundary.
pub(crate) fn find_char_boundary(s: &str, target: usize) -> usize {
    if target >= s.len() {
        return s.len();
    }
    let mut i = target;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Start of the char that ends at `idx` (`idx` itself when it is 0).
fn prev_char_start(s: &str, idx: usize) -> usize {
    if idx == 0 {
        return 0;
    }
    let mut i = idx - 1;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Byte length of the char starting at `idx` (1 at end of text).
fn char_len_at(s: &str, idx: usize) -> usize {
    s[idx..].chars().next().map_or(1, char::len_utf8)
}

type Found<'t> = (usize, usize, Option<Captures<'t>>);

fn find_next<'t>(re: &Regex, text: &'t str, pos: usize, need_caps: bool) -> Option<Found<'t>> {
    if need_caps {
        let caps = re.captures_at(text, pos)?;
        let m = caps.get(0).expect("group 0 always participates");
        Some((m.start(), m.end(), Some(caps)))
    } else {
        let m = re.find_at(text, pos)?;
        Some((m.start(), m.end(), None))
    }
}

/// Scan the whole `rope`, reporting every match to `sink`.
///
/// * `is_last_segment` — `false` for a non-final parallel segment (see module docs).
/// * `buf` — scratch window buffer; reuse it across calls to avoid reallocations.
#[allow(clippy::too_many_arguments)]
pub fn scan_rope(
    rope: &Rope,
    is_last_segment: bool,
    re: &Regex,
    need_caps: bool,
    sink: &mut impl MatchSink,
    ctl: &dyn ScanControl,
    cfg: &ScanConfig,
    buf: &mut String,
) -> Result<(), Cancelled> {
    debug_assert!(cfg.window_size > cfg.overlap);
    let single = rope.len_bytes() <= cfg.single_window_max;
    buf.clear();
    let mut chunks = rope.chunks();
    let mut eof = false;

    // Absolute offset of `buf[0]`.
    let mut window_abs = 0usize;
    // Matches are owned from here on (absolute).
    let mut cut_abs = 0usize;
    // End (absolute) of the previous match, carried across windows.
    let mut last_end_abs: Option<usize> = None;
    let mut hits = 0usize;
    let mut hits_reported = 0usize;

    loop {
        if ctl.is_cancelled() {
            return Err(Cancelled);
        }

        if single {
            for c in chunks.by_ref() {
                buf.push_str(c);
            }
            eof = true;
        } else {
            while buf.len() < cfg.window_size && !eof {
                match chunks.next() {
                    Some(c) => buf.push_str(c),
                    None => eof = true,
                }
            }
        }

        let is_final = eof;
        let text_len = buf.len();
        // Aligned BEFORE scanning so ownership and `cut` agree exactly.
        let safe_end = if is_final {
            text_len
        } else {
            find_char_boundary(buf, text_len - cfg.overlap)
        };

        let next_cut_rel;
        let last_end_rel_out;
        {
            let win = Window { text: buf.as_str(), abs_start: window_abs };
            let mut pos = cut_abs - window_abs;
            let mut last_end_rel = last_end_abs.and_then(|a| a.checked_sub(window_abs));

            while pos <= text_len {
                let Some((s, e, caps)) = find_next(re, win.text, pos, need_caps) else {
                    break;
                };

                // Same rule as `Regex::find_iter`: an empty match right after the
                // previous match is skipped by retrying one char further.
                if s == e && Some(e) == last_end_rel {
                    if pos >= text_len {
                        break;
                    }
                    pos += char_len_at(win.text, pos);
                    continue;
                }

                if is_final {
                    // Zero-width match at the fake EOF of a non-last segment:
                    // it is offset 0 of the next segment.
                    if !is_last_segment && s == text_len {
                        break;
                    }
                } else if s >= safe_end {
                    break;
                }

                sink.on_match(&win, s, e, caps.as_ref());
                last_end_rel = Some(e);

                hits += 1;
                if hits & CANCEL_CHECK_MASK == 0 {
                    if ctl.is_cancelled() {
                        return Err(Cancelled);
                    }
                    ctl.add_matches(hits - hits_reported);
                    hits_reported = hits;
                }

                if s == e {
                    // Searching again at `e` would return this same empty match (only
                    // to be skipped above), so step over one char right away.
                    if e >= text_len {
                        break;
                    }
                    pos = e + char_len_at(win.text, e);
                } else {
                    pos = e;
                }
                // Every later match starts at >= `pos`, so none is owned by this
                // window: skip scanning the overlap tail.
                if !is_final && pos >= safe_end {
                    break;
                }
            }

            next_cut_rel = if is_final {
                text_len
            } else {
                safe_end.max(last_end_rel.unwrap_or(0))
            };
            sink.flush(&win, next_cut_rel);
            last_end_rel_out = last_end_rel;
        }

        let next_cut_abs = window_abs + next_cut_rel;
        ctl.add_done(next_cut_abs - cut_abs);
        last_end_abs = last_end_rel_out.map(|r| window_abs + r);

        if is_final {
            ctl.add_matches(hits - hits_reported);
            return Ok(());
        }

        cut_abs = next_cut_abs;
        // Keep one char of left context for look-behind assertions.
        let keep_from = prev_char_start(buf, next_cut_rel);
        buf.drain(..keep_from);
        window_abs += keep_from;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Collect(Vec<(usize, usize)>);

    impl MatchSink for Collect {
        fn on_match(&mut self, win: &Window, start: usize, end: usize, _c: Option<&Captures>) {
            self.0.push((win.abs_start + start, win.abs_start + end));
        }
        fn flush(&mut self, _win: &Window, _upto: usize) {}
    }

    fn tiny() -> ScanConfig {
        ScanConfig { window_size: 48, overlap: 12, single_window_max: 0 }
    }

    fn reference(re: &Regex, text: &str) -> Vec<(usize, usize)> {
        re.find_iter(text).map(|m| (m.start(), m.end())).collect()
    }

    fn windowed(re: &Regex, text: &str, cfg: &ScanConfig) -> Vec<(usize, usize)> {
        let rope = Rope::from_str(text);
        let mut sink = Collect(Vec::new());
        let mut buf = String::new();
        scan_rope(&rope, true, re, false, &mut sink, &NoControl, cfg, &mut buf).unwrap();
        sink.0
    }

    #[test]
    fn windowed_matches_find_iter_for_many_patterns() {
        let text = "héllo wörld 你好世界 abc\nfoo bar baz\n\nqux 你好 foo\n".repeat(40);
        for pat in [
            "foo", "你好", r"\bfoo\b", "a*", "(?m)^", "(?m)$", r"\B", r"\b", "x*", "(?m)^f", r"\w+", r"(?m)^\w+",
            r"(?m)\w+$", "o+", r"[a-z]+\s",
            // Non-empty match directly followed by an empty one, lazy empties, and
            // empty matches at every position.
            "x*?", "a*?", r"\w*", "b*", r"(?m)^|$", r"\b|o",
        ] {
            let re = regex::RegexBuilder::new(pat).multi_line(true).build().unwrap();
            for cfg in [
                tiny(),
                ScanConfig { window_size: 40, overlap: 16, single_window_max: 0 },
                ScanConfig { window_size: 96, overlap: 40, single_window_max: 0 },
            ] {
                assert_eq!(windowed(&re, &text, &cfg), reference(&re, &text), "pattern {pat:?} cfg {cfg:?}");
            }
        }
    }

    #[test]
    fn text_level_anchors_do_not_misfire_at_window_edges() {
        let text = "abc def ghi jkl mno pqr stu vwx yz 你好".repeat(10);
        for pat in [r"\Aabc", r"yz 你好\z", r"\A", r"\z"] {
            let re = Regex::new(pat).unwrap();
            assert_eq!(windowed(&re, &text, &tiny()), reference(&re, &text), "pattern {pat:?}");
        }
    }

    #[test]
    fn multibyte_char_at_safe_end_is_not_processed_twice() {
        // Every window edge lands inside some 3-byte char for some overlap value.
        let text = "你".repeat(200);
        for overlap in 5..20 {
            let cfg = ScanConfig { window_size: 60, overlap, single_window_max: 0 };
            for pat in ["你", "", "你你"] {
                let re = Regex::new(pat).unwrap();
                assert_eq!(windowed(&re, &text, &cfg), reference(&re, &text), "overlap {overlap} pattern {pat:?}");
            }
        }
    }

    #[test]
    fn single_window_mode_matches_reference() {
        let text = "a1b22c333\n".repeat(30);
        let re = Regex::new(r"\d+").unwrap();
        let cfg = ScanConfig { single_window_max: usize::MAX, ..tiny() };
        assert_eq!(windowed(&re, &text, &cfg), reference(&re, &text));
    }

    #[test]
    fn non_last_segment_drops_zero_width_match_at_fake_eof() {
        let rope = Rope::from_str("ab\ncd\n");
        let re = regex::RegexBuilder::new("(?m)^").multi_line(true).build().unwrap();
        let cfg = ScanConfig { single_window_max: usize::MAX, ..tiny() };
        let mut buf = String::new();

        let mut sink = Collect(Vec::new());
        scan_rope(&rope, false, &re, false, &mut sink, &NoControl, &cfg, &mut buf).unwrap();
        assert_eq!(sink.0, vec![(0, 0), (3, 3)], "offset 6 belongs to the next segment");

        let mut sink = Collect(Vec::new());
        scan_rope(&rope, true, &re, false, &mut sink, &NoControl, &cfg, &mut buf).unwrap();
        assert_eq!(sink.0, vec![(0, 0), (3, 3), (6, 6)]);
    }

    #[test]
    fn dense_matches_are_cancelled_within_a_single_window() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        // Cancelled from the second check on: the first happens before scanning,
        // the second only after `CANCEL_CHECK_MASK + 1` hits inside the window.
        struct CancelOnSecondCheck(AtomicUsize);
        impl ScanControl for CancelOnSecondCheck {
            fn is_cancelled(&self) -> bool {
                self.0.fetch_add(1, Ordering::Relaxed) >= 1
            }
            fn add_done(&self, _n: usize) {}
            fn add_matches(&self, _n: usize) {}
        }
        let rope = Rope::from_str(&"a".repeat(20_000));
        let re = Regex::new("a").unwrap();
        let cfg = ScanConfig { single_window_max: usize::MAX, ..tiny() };
        let mut sink = Collect(Vec::new());
        let mut buf = String::new();
        let ctl = CancelOnSecondCheck(AtomicUsize::new(0));
        let r = scan_rope(&rope, true, &re, false, &mut sink, &ctl, &cfg, &mut buf);
        assert_eq!(r, Err(Cancelled));
        assert_eq!(sink.0.len(), CANCEL_CHECK_MASK + 1);
    }

    #[test]
    fn cancel_flag_stops_the_scan() {
        struct Cancelling;
        impl ScanControl for Cancelling {
            fn is_cancelled(&self) -> bool {
                true
            }
            fn add_done(&self, _n: usize) {}
            fn add_matches(&self, _n: usize) {}
        }
        let rope = Rope::from_str("aaaa");
        let re = Regex::new("a").unwrap();
        let mut sink = Collect(Vec::new());
        let mut buf = String::new();
        let r = scan_rope(&rope, true, &re, false, &mut sink, &Cancelling, &tiny(), &mut buf);
        assert_eq!(r, Err(Cancelled));
        assert!(sink.0.is_empty());
    }
}
