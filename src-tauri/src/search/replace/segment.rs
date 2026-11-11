//! Splits a rope into line-aligned segments for parallel scanning.

use ropey::Rope;

/// Default size of one segment.
pub const SEGMENT_TARGET: usize = 4 * 1024 * 1024;

/// Byte offset just past the first `\n` at or after `from`, if any.
///
/// Searches for a real `\n` byte rather than using ropey's line API, because
/// ropey also treats `\r`, U+2028, ... as line breaks while segment boundaries
/// must be exactly `\n`.
fn newline_end_at_or_after(rope: &Rope, from: usize) -> Option<usize> {
    let total = rope.len_bytes();
    let mut b = from;
    while b < total {
        let (chunk, chunk_start, _, _) = rope.chunk_at_byte(b);
        if let Some(i) = memchr::memchr(b'\n', &chunk.as_bytes()[b - chunk_start..]) {
            return Some(b + i + 1);
        }
        b = chunk_start + chunk.len();
    }
    None
}

/// Cut `rope` into pieces of roughly `target` bytes.
///
/// * Every piece except the last ends with `\n`.
/// * Each cut is made right after the first `\n` at or beyond `target` bytes, so
///   every piece advances at least one whole line (a huge single line simply
///   becomes one large piece; there is no empty-piece loop).
/// * Pieces are `Rope::split_off` clones: O(log n) each and sharing all leaves.
pub fn split_segments(rope: &Rope, target: usize) -> Vec<Rope> {
    let target = target.max(1);
    let mut segs = Vec::new();
    let mut rest = rope.clone();
    while rest.len_bytes() > target {
        match newline_end_at_or_after(&rest, target - 1) {
            Some(after) if after < rest.len_bytes() => {
                let c = rest.byte_to_char(after);
                let tail = rest.split_off(c);
                segs.push(std::mem::replace(&mut rest, tail));
            }
            _ => break,
        }
    }
    segs.push(rest);
    segs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(segs: &[Rope]) -> String {
        segs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn segments_end_with_newline_and_concatenate_back() {
        let text = "line one\nsecond line here\n你好世界\nx\n".repeat(50);
        let rope = Rope::from_str(&text);
        for target in [1, 7, 20, 64, 1000, 100_000] {
            let segs = split_segments(&rope, target);
            assert_eq!(joined(&segs), text, "target {target}");
            for s in &segs[..segs.len() - 1] {
                assert!(s.to_string().ends_with('\n'), "target {target}");
                assert!(s.len_bytes() >= target.min(text.len()), "target {target}");
            }
        }
    }

    #[test]
    fn huge_single_line_becomes_one_segment() {
        let text = "x".repeat(10_000);
        let segs = split_segments(&Rope::from_str(&text), 100);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].to_string(), text);
    }

    #[test]
    fn long_line_followed_by_more_lines_makes_progress() {
        let text = format!("{}\nshort\nlines\n", "y".repeat(1000));
        let segs = split_segments(&Rope::from_str(&text), 10);
        assert_eq!(joined(&segs), text);
        assert!(segs.iter().all(|s| s.len_bytes() > 0));
        // The tail ("short\nlines\n") has no newline at/after byte 9 that is not
        // the very end, so it stays together as the last segment.
        assert_eq!(segs.len(), 2);
    }

    #[test]
    fn carriage_returns_and_unicode_separators_are_not_cut_points() {
        let text = "a\rb\u{2028}c\u{0085}d\ne\n";
        let segs = split_segments(&Rope::from_str(text), 2);
        assert_eq!(joined(&segs), text);
        for s in &segs[..segs.len() - 1] {
            assert!(s.to_string().ends_with('\n'));
        }
    }

    #[test]
    fn empty_and_small_ropes() {
        assert_eq!(split_segments(&Rope::from_str(""), 10).len(), 1);
        assert_eq!(split_segments(&Rope::from_str("abc\n"), 100).len(), 1);
    }
}
