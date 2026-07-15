use crate::buffer::{Buffer, BufferRegistry, LineEnding};
use ropey::Rope;
use serde::{Deserialize, Serialize};
use tauri::State;
use unicode_width::UnicodeWidthChar;

use crate::AppState;

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CsvDetectResult {
    pub delimiter: String,
    pub field_widths: Vec<usize>,
}

// ──────────────────────────────────────────────────────────────
// CSV parsing helpers
// ──────────────────────────────────────────────────────────────

/// Split a single CSV line into fields, optionally respecting quoted regions.
/// Fields are returned as owned strings with surrounding quotes stripped (if any).
fn split_line(
    line: &str,
    delimiter: char,
    ignore_single_quotes: bool,
    ignore_double_quotes: bool,
) -> Vec<String> {
    let mut fields: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\'' && ignore_single_quotes {
            in_single = !in_single;
            // Don't include the quote character in the field value
            continue;
        }
        if ch == '"' && ignore_double_quotes {
            in_double = !in_double;
            continue;
        }
        if ch == delimiter && !in_single && !in_double {
            fields.push(current.clone());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    fields.push(current);
    fields
}

/// Calculate the display width of a string (accounts for wide CJK characters).
fn display_width(s: &str) -> usize {
    s.chars()
        .map(|c| UnicodeWidthChar::width(c).unwrap_or(0))
        .sum()
}

/// Try a candidate delimiter on up to `max_lines` lines; return (field_count_mode, stddev-like score).
/// Lower score = more consistent field counts → better delimiter.
fn score_delimiter(lines: &[&str], delim: char) -> (usize, f64) {
    let counts: Vec<usize> = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.chars().filter(|&c| c == delim).count() + 1)
        .collect();
    if counts.is_empty() {
        return (1, f64::MAX);
    }
    // Mode
    let mut freq: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for &c in &counts {
        *freq.entry(c).or_insert(0) += 1;
    }
    let mode = *freq.iter().max_by_key(|(_, v)| *v).map(|(k, _)| k).unwrap_or(&1);
    if mode <= 1 {
        // Delimiter not found in lines → useless
        return (1, f64::MAX);
    }
    let mean = counts.iter().sum::<usize>() as f64 / counts.len() as f64;
    let variance = counts.iter().map(|&c| (c as f64 - mean).powi(2)).sum::<f64>() / counts.len() as f64;
    (mode, variance)
}

// ──────────────────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────────────────

/// Scan the first `max_lines` rows of a buffer to detect the CSV delimiter
/// and the maximum display width of each field column.
#[tauri::command]
pub fn csv_detect(
    state: State<AppState>,
    buffer_id: u64,
    max_lines: usize,
) -> Result<CsvDetectResult, String> {
    let content = {
        let buffers = state.registry.buffers.lock().unwrap();
        let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
        buf.rope.to_string()
    };

    let all_lines: Vec<&str> = content.lines().take(max_lines).collect();

    // Candidate delimiters in preference order: comma, tab, pipe, semicolon
    let candidates: &[(char, &str)] = &[
        (',', ","),
        ('\t', "\t"),
        ('|', "|"),
        (';', ";"),
    ];

    let (best_delim_char, best_delim_str) = candidates
        .iter()
        .map(|(ch, s)| {
            let (mode, score) = score_delimiter(&all_lines, *ch);
            (*ch, *s, mode, score)
        })
        .filter(|(_, _, mode, score)| *mode > 1 && *score < f64::MAX)
        .min_by(|a, b| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(ch, s, _, _)| (ch, s))
        .unwrap_or((',', ","));

    // Compute per-column max display widths
    let mut max_widths: Vec<usize> = Vec::new();
    for line in &all_lines {
        if line.trim().is_empty() {
            continue;
        }
        let fields = split_line(line, best_delim_char, true, true);
        for (i, field) in fields.iter().enumerate() {
            let w = display_width(field.trim());
            if i >= max_widths.len() {
                max_widths.resize(i + 1, 0);
            }
            if w > max_widths[i] {
                max_widths[i] = w;
            }
        }
    }

    // Minimum column width = 1
    let field_widths: Vec<usize> = max_widths.into_iter().map(|w| w.max(1)).collect();

    Ok(CsvDetectResult {
        delimiter: best_delim_str.to_string(),
        field_widths,
    })
}

/// Convert the full content of `buffer_id` from CSV to fixed-width format,
/// returning a new (unsaved) buffer's FileInfo.
#[tauri::command]
pub fn csv_to_fixed_width(
    state: State<AppState>,
    buffer_id: u64,
    delimiter: String,
    field_widths: Vec<usize>,
    ignore_single_quotes: bool,
    ignore_double_quotes: bool,
) -> Result<crate::buffer::FileInfo, String> {
    if delimiter.is_empty() {
        return Err("分隔符不能为空".to_string());
    }
    if field_widths.is_empty() {
        return Err("字段宽度不能为空".to_string());
    }

    let delim_char = delimiter.chars().next().unwrap();

    let content = {
        let buffers = state.registry.buffers.lock().unwrap();
        let buf = buffers.get(&buffer_id).ok_or("Buffer not found")?;
        buf.rope.to_string()
    };

    let mut output = String::with_capacity(content.len());

    for line in content.lines() {
        if line.trim().is_empty() {
            output.push('\n');
            continue;
        }
        let fields = split_line(line, delim_char, ignore_single_quotes, ignore_double_quotes);
        for (i, width) in field_widths.iter().enumerate() {
            let raw = fields.get(i).map(|s| s.trim()).unwrap_or("");
            let w = display_width(raw);
            if w >= *width {
                // Truncate by character count (keeping display width ≤ target)
                let mut used = 0usize;
                for ch in raw.chars() {
                    let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
                    if used + cw > *width {
                        break;
                    }
                    output.push(ch);
                    used += cw;
                }
                // Pad if wide chars left a gap (e.g., width=3 but we wrote 2 wide chars)
                for _ in used..*width {
                    output.push(' ');
                }
            } else {
                output.push_str(raw);
                for _ in w..*width {
                    output.push(' ');
                }
            }
        }
        output.push('\n');
    }

    // Create a new buffer with the converted content
    let new_id = BufferRegistry::next_id();
    let rope = Rope::from_str(&output);
    let mut buf = Buffer::from_rope(new_id, rope, None, "UTF-8".to_string(), LineEnding::Lf);
    buf.is_modified = true;
    let info = buf.file_info();
    state.registry.insert(buf);

    Ok(info)
}
