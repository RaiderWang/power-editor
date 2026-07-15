use anyhow::{anyhow, Result};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::buffer::BufferRegistry;

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

/// Build a Regex from SearchParams
fn build_regex(params: &SearchParams) -> Result<Regex> {
    let pattern = if params.is_regex {
        params.pattern.clone()
    } else {
        regex::escape(&params.pattern)
    };

    let pattern = if params.whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };

    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!params.case_sensitive)
        .build()
        .map_err(|e| anyhow!("Invalid regex: {}", e))?;

    Ok(re)
}

/// Find all matches in a buffer, returning up to max_results.
///
/// Uses the rope's O(log n) line index for `line` / `column` instead of
/// scanning bytes from the start for every match (the old `count_lines_before`
/// approach was O(n*k) and dominated the runtime for high-frequency patterns).
pub fn find_all(
    registry: &BufferRegistry,
    buffer_id: u64,
    params: &SearchParams,
    max_results: usize,
) -> Result<FindResult> {
    let buffers = registry.buffers.lock().unwrap();
    let buffer = buffers.get(&buffer_id).ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;

    let re = build_regex(params)?;

    let text = buffer.rope.to_string();
    let rope = &buffer.rope;

    let mut matches = Vec::new();
    let mut total = 0;
    let truncated_limit = max_results;

    for m in re.find_iter(&text) {
        total += 1;
        if matches.len() < truncated_limit {
            let from = m.start();
            let to = m.end();
            let char_idx = rope.byte_to_char(from);
            let line = rope.char_to_line(char_idx);
            let line_start_char = rope.line_to_char(line);
            let line_start_byte = rope.char_to_byte(line_start_char);
            let column = from - line_start_byte;

            let line_end_char = if line + 1 < rope.len_lines() {
                rope.line_to_char(line + 1) - 1 // exclude trailing \n
            } else {
                rope.len_chars()
            };
            let line_end_byte = rope.char_to_byte(line_end_char);
            let preview: String = text[line_start_byte..line_end_byte]
                .chars()
                .take(200)
                .collect();

            matches.push(SearchMatch {
                from,
                to,
                line,
                column,
                preview,
            });
        }
    }

    Ok(FindResult {
        truncated: total > truncated_limit,
        total,
        matches,
    })
}

/// Replace all occurrences, return the new full text (applied to buffer)
pub fn replace_all(
    registry: &BufferRegistry,
    buffer_id: u64,
    params: &SearchParams,
    replacement: &str,
) -> Result<usize> {
    let re = build_regex(params)?;

    let mut buffers = registry.buffers.lock().unwrap();
    let buffer = buffers.get_mut(&buffer_id).ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;

    let text = buffer.rope.to_string();
    let result = re.replace_all(&text, replacement);
    let count = re.find_iter(&text).count();

    if count > 0 {
        buffer.rope = ropey::Rope::from_str(&result);
        buffer.is_modified = true;
    }

    Ok(count)
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
    let buffer = buffers.get_mut(&buffer_id).ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;

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

