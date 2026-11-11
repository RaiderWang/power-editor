//! Decides whether Replace All may scan line-aligned segments in parallel.
//!
//! Segments are cut right after a `\n`. Scanning them independently is exactly
//! equivalent to one scan over the whole text only if
//!
//! 1. no match can contain a `\n` (so no match spans two segments), and
//! 2. the pattern has no text-level anchors (`\A`, `\z`, or non-multi-line `^`/`$`),
//!    which would misfire at every segment start / end.
//!
//! The pattern is parsed with the same flags as `build_regex` and its HIR walked;
//! anything unusual simply answers "no" and the sequential path is used.

use regex_syntax::hir::{Class, Hir, HirKind, Look};

use super::{build_pattern, SearchParams};

pub fn can_parallelize(params: &SearchParams) -> bool {
    can_parallelize_pattern(&build_pattern(params), params.case_sensitive)
}

pub(crate) fn can_parallelize_pattern(pattern: &str, case_sensitive: bool) -> bool {
    let mut parser = regex_syntax::ParserBuilder::new()
        .case_insensitive(!case_sensitive)
        .multi_line(true)
        .build();
    let Ok(hir) = parser.parse(pattern) else {
        return false;
    };

    let looks = hir.properties().look_set();
    if [Look::Start, Look::End, Look::StartCRLF, Look::EndCRLF]
        .iter()
        .any(|l| looks.contains(*l))
    {
        return false;
    }

    !can_match_newline(&hir)
}

/// Conservative: `true` whenever the sub-pattern might match a `\n`.
fn can_match_newline(hir: &Hir) -> bool {
    match hir.kind() {
        HirKind::Empty | HirKind::Look(_) => false,
        HirKind::Literal(lit) => lit.0.contains(&b'\n'),
        HirKind::Class(Class::Unicode(c)) => c.ranges().iter().any(|r| r.start() <= '\n' && '\n' <= r.end()),
        HirKind::Class(Class::Bytes(c)) => c.ranges().iter().any(|r| r.start() <= b'\n' && b'\n' <= r.end()),
        HirKind::Repetition(rep) => can_match_newline(&rep.sub),
        HirKind::Capture(cap) => can_match_newline(&cap.sub),
        HirKind::Concat(subs) | HirKind::Alternation(subs) => subs.iter().any(can_match_newline),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(p: &str) -> bool {
        can_parallelize_pattern(p, true)
    }

    #[test]
    fn simple_patterns_are_parallel() {
        assert!(ok("foo"));
        assert!(ok(r"\bfoo\b"));
        assert!(ok(r"foo.*bar"));
        assert!(ok(r"(?m)^foo"));
        assert!(ok(r"^foo"), "multi_line is on, so ^ is a line anchor");
        assert!(ok(r"bar$"));
        assert!(ok(r"\d+"));
        assert!(ok(r"a*"));
    }

    #[test]
    fn patterns_that_can_cross_lines_are_sequential() {
        assert!(!ok("a\nb"));
        assert!(!ok(r"\s+"));
        assert!(!ok(r"a[^x]b"));
        assert!(!ok(r"(?s)a.b"));
        assert!(!ok(r"\W"));
        assert!(!ok(r"\D"));
        assert!(!ok(r"a|\n"));
    }

    #[test]
    fn text_level_anchors_are_sequential() {
        assert!(!ok(r"\Afoo"));
        assert!(!ok(r"foo\z"));
        assert!(!ok(r"(?-m)^foo"));
    }

    #[test]
    fn invalid_pattern_is_not_parallel() {
        assert!(!ok("("));
    }
}
