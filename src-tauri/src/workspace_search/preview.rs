//! Line-preview construction and newline normalisation for the content scanner.

use std::borrow::Cow;

/// Characters of context kept before the match.
const CONTEXT_BEFORE: usize = 40;
/// Characters of the match itself that are kept (and highlighted).
const MAX_MATCH_CHARS: usize = 120;
/// Characters of context kept after the match.
const CONTEXT_AFTER: usize = 80;

const ELLIPSIS: &str = "…";

pub struct Preview {
    pub text: String,
    /// Highlight range in UTF-16 code units.
    pub hl_start: u32,
    pub hl_end: u32,
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Normalise `\r\n` and lone `\r` to `\n`, exactly like the streaming loader does for
/// the Rope. Borrows when the text has no `\r`.
pub fn normalize_newlines(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let Some(first) = memchr::memchr(b'\r', bytes) else {
        return Cow::Borrowed(text);
    };
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut cr = first;
    loop {
        out.push_str(&text[cursor..cr]);
        out.push('\n');
        cursor = if bytes.get(cr + 1) == Some(&b'\n') { cr + 2 } else { cr + 1 };
        match memchr::memchr(b'\r', &bytes[cursor..]) {
            Some(rel) => cr = cursor + rel,
            None => {
                out.push_str(&text[cursor..]);
                break;
            }
        }
    }
    Cow::Owned(out)
}

/// Build the preview of the line `text[line_start..line_end]` around the match
/// `text[m_start..m_end]` (`m_end <= line_end`). Only a bounded window around the match
/// is touched, so very long lines (minified files) stay cheap.
pub fn build_preview(
    text: &str,
    line_start: usize,
    line_end: usize,
    m_start: usize,
    m_end: usize,
) -> Preview {
    // Window start: up to CONTEXT_BEFORE chars before the match.
    let before_all = &text[line_start..m_start];
    let mut win_start = m_start;
    let mut count = 0;
    let mut cut_front = false;
    for (i, _) in before_all.char_indices().rev() {
        if count == CONTEXT_BEFORE {
            cut_front = true;
            break;
        }
        win_start = line_start + i;
        count += 1;
    }
    if !cut_front {
        // Drop indentation only when the window reaches the real line start.
        let trimmed = text[win_start..m_start].trim_start();
        win_start = m_start - trimmed.len();
    }

    // The match, capped.
    let m_text = &text[m_start..m_end];
    let (hl_end_byte, cut_match) = match m_text.char_indices().nth(MAX_MATCH_CHARS) {
        Some((i, _)) => (m_start + i, true),
        None => (m_end, false),
    };

    // Window end: up to CONTEXT_AFTER chars after the match.
    let (win_end, cut_back) = if cut_match {
        (hl_end_byte, true)
    } else {
        let after_all = &text[m_end..line_end];
        match after_all.char_indices().nth(CONTEXT_AFTER) {
            Some((i, _)) => (m_end + i, true),
            None => (line_end, false),
        }
    };

    let mut out = String::with_capacity((win_end - win_start) + 8);
    if cut_front {
        out.push_str(ELLIPSIS);
    }
    out.push_str(&text[win_start..m_start]);
    let hl_start = utf16_len(&out);
    out.push_str(&text[m_start..hl_end_byte]);
    let hl_end = utf16_len(&out);
    if win_end > hl_end_byte {
        out.push_str(text[hl_end_byte..win_end].trim_end());
    }
    if cut_back {
        out.push_str(ELLIPSIS);
    }
    Preview { text: out, hl_start, hl_end }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_matches_loader_semantics() {
        assert_eq!(normalize_newlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert_eq!(normalize_newlines("a\r\r\nb"), "a\n\nb");
        assert_eq!(normalize_newlines("x\r"), "x\n");
        assert!(matches!(normalize_newlines("plain\n"), Cow::Borrowed(_)));
    }

    #[test]
    fn preview_highlights_match_in_utf16_units() {
        let text = "  你好 foo 世界\nnext";
        let m_start = text.find("foo").unwrap();
        let p = build_preview(text, 0, text.find('\n').unwrap(), m_start, m_start + 3);
        assert_eq!(p.text, "你好 foo 世界");
        let units: Vec<u16> = p.text.encode_utf16().collect();
        let hl = String::from_utf16(&units[p.hl_start as usize..p.hl_end as usize]).unwrap();
        assert_eq!(hl, "foo");
    }

    #[test]
    fn preview_cuts_long_lines_on_both_sides() {
        let line = format!("{}NEEDLE{}", "a".repeat(500), "b".repeat(500));
        let m_start = 500;
        let p = build_preview(&line, 0, line.len(), m_start, m_start + 6);
        assert!(p.text.starts_with('…') && p.text.ends_with('…'));
        assert!(p.text.chars().count() <= CONTEXT_BEFORE + 6 + CONTEXT_AFTER + 2);
        let units: Vec<u16> = p.text.encode_utf16().collect();
        let hl = String::from_utf16(&units[p.hl_start as usize..p.hl_end as usize]).unwrap();
        assert_eq!(hl, "NEEDLE");
    }
}
