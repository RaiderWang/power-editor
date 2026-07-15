/// UltraEdit .uew wordfile parser
/// Produces a SyntaxRule JSON structure consumed by the frontend CodeMirror extension.
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// A fully parsed language definition from a wordfile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageDef {
    pub name: String,
    pub extensions: Vec<String>,
    pub case_sensitive: bool,
    /// Up to 8 keyword groups, each with a list of keywords
    pub keyword_groups: Vec<Vec<String>>,
    pub line_comment: Option<String>,
    pub block_comment_start: Option<String>,
    pub block_comment_end: Option<String>,
    pub string_chars: Vec<char>,
    pub delimiters: String,
    pub indent_with: Option<String>,
}

/// All language definitions from a wordfile (a .uew can contain multiple /L# sections)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordfileDef {
    pub languages: Vec<LanguageDef>,
}

pub fn parse_wordfile(path: &Path) -> Result<WordfileDef> {
    let raw = fs::read(path)?;

    // Try UTF-8 first, fall back to latin-1
    let content = match std::str::from_utf8(&raw) {
        Ok(s) => s.to_string(),
        Err(_) => raw.iter().map(|&b| b as char).collect(),
    };

    // Normalize line endings
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    Ok(parse_content(&content))
}

pub fn parse_content(content: &str) -> WordfileDef {
    let mut languages: Vec<LanguageDef> = Vec::new();
    let mut current: Option<LanguageDef> = None;
    let mut current_kw_group: Option<usize> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip empty lines and pure comments (starting with ;)
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }

        // Language definition line: /L#"Name" ...
        if trimmed.starts_with("/L") && trimmed.len() > 2 {
            if let Some(lang) = current.take() {
                languages.push(lang);
            }
            current_kw_group = None;
            current = Some(parse_language_header(trimmed));
            continue;
        }

        let Some(lang) = current.as_mut() else { continue };

        // Delimiter definition
        if trimmed.starts_with("/Delimiters") || trimmed.starts_with("/Delimiter") {
            if let Some(eq) = trimmed.find('=') {
                lang.delimiters = trimmed[eq + 1..].trim().to_string();
            }
            continue;
        }

        // File extensions: /FE="*.c *.h"
        if trimmed.starts_with("/FE") {
            lang.extensions = parse_extensions(trimmed);
            continue;
        }

        // Nocase flag
        if trimmed.eq_ignore_ascii_case("Nocase") || trimmed.contains("Nocase") {
            lang.case_sensitive = false;
            continue;
        }

        // Keyword group marker: /Keyword Colors
        if trimmed.starts_with("/Keyword") {
            current_kw_group = None;
            continue;
        }

        // New-style keyword groups: /C1"Name", /C2"Name", /C20"Name", etc.
        // The char after "/C" must be a digit to distinguish from "/Close Brace Strings" etc.
        if trimmed.starts_with("/C") {
            let after_c = &trimmed[2..];
            let digit_end = after_c
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(after_c.len());
            if digit_end > 0 {
                if let Ok(idx) = after_c[..digit_end].parse::<usize>() {
                    if idx > 0 {
                        let group_idx = idx - 1;
                        while lang.keyword_groups.len() <= group_idx {
                            lang.keyword_groups.push(Vec::new());
                        }
                        current_kw_group = Some(group_idx);
                        continue;
                    }
                }
            }
        }

        // Keyword group index: #keyword1# ... #keyword8# (legacy format)
        if trimmed.starts_with('#') && trimmed.ends_with('#') {
            let inner = trimmed.trim_matches('#').to_lowercase();
            if inner.starts_with("keyword") {
                let idx: usize = inner["keyword".len()..].trim().parse().unwrap_or(1);
                let group_idx = idx.saturating_sub(1);
                while lang.keyword_groups.len() <= group_idx {
                    lang.keyword_groups.push(Vec::new());
                }
                current_kw_group = Some(group_idx);
            }
            continue;
        }

        // Keywords are space-separated on non-directive lines
        if let Some(group_idx) = current_kw_group {
            let words: Vec<String> = trimmed
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            lang.keyword_groups[group_idx].extend(words);
        }
    }

    if let Some(lang) = current {
        languages.push(lang);
    }

    WordfileDef { languages }
}

fn parse_language_header(line: &str) -> LanguageDef {
    // Example: /L3"C++" Line Comment=// Block Comment On=/* Block Comment Off=*/
    // Also handles: /L13"MySQL 5.1" Nocase Line Comment = # Block Comment On = /* File Extensions = SQL
    let mut name = String::new();
    let mut line_comment: Option<String> = None;
    let mut block_start: Option<String> = None;
    let mut block_end: Option<String> = None;
    let mut case_sensitive = true;
    let mut extensions: Vec<String> = Vec::new();

    // Extract quoted name
    if let Some(q1) = line.find('"') {
        if let Some(q2) = line[q1 + 1..].find('"') {
            name = line[q1 + 1..q1 + 1 + q2].to_string();
        }
    }

    // Parse attributes after the name
    let rest = if let Some(q2_pos) = line.rfind('"') {
        &line[q2_pos + 1..]
    } else {
        ""
    };

    // First pass: handle "Key=Value" (no spaces) and standalone "Nocase"
    for part in rest.split_whitespace() {
        if let Some(val) = part.strip_prefix("Line Comment=") {
            line_comment = Some(val.to_string());
        } else if let Some(val) = part.strip_prefix("Block Comment On=") {
            block_start = Some(val.to_string());
        } else if let Some(val) = part.strip_prefix("Block Comment Off=") {
            block_end = Some(val.to_string());
        } else if part.eq_ignore_ascii_case("Nocase") {
            case_sensitive = false;
        }
    }

    // Second pass: handle "Key = Value" (with spaces around =) using header_attr helper
    let rest_lower = rest.to_lowercase();
    if rest_lower.contains("nocase") {
        case_sensitive = false;
    }
    if line_comment.is_none() {
        line_comment = header_attr(rest, &rest_lower, "Line Comment");
    }
    if block_start.is_none() {
        block_start = header_attr(rest, &rest_lower, "Block Comment On");
    }
    if block_end.is_none() {
        block_end = header_attr(rest, &rest_lower, "Block Comment Off");
    }

    // Parse file extensions from header line: "File Extensions = SQL" or "File Extensions=*.sql"
    if let Some(pos) = rest_lower.find("file extensions") {
        let after_key = rest[pos + "file extensions".len()..].trim_start();
        if after_key.starts_with('=') {
            extensions = after_key[1..].trim_start()
                .split_whitespace()
                .map(|s| s.trim_start_matches("*.").to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    LanguageDef {
        name,
        extensions,
        case_sensitive,
        keyword_groups: Vec::new(),
        line_comment,
        block_comment_start: block_start,
        block_comment_end: block_end,
        string_chars: vec!['"', '\''],
        delimiters: "~!@%^&*()-+=|\\/{}[]:;\"'<>,.?".to_string(),
        indent_with: None,
    }
}

/// Find the value of a header attribute that may use "Key=Value" or "Key = Value" format.
/// `rest_lower` must be `rest.to_lowercase()`.
fn header_attr(rest: &str, rest_lower: &str, key: &str) -> Option<String> {
    let key_low = key.to_lowercase();
    let pos = rest_lower.find(&key_low)?;
    let after_key = rest[pos + key.len()..].trim_start();
    if !after_key.starts_with('=') {
        return None;
    }
    let val = after_key[1..].trim_start().split_whitespace().next()?.to_string();
    if val.is_empty() { None } else { Some(val) }
}

fn parse_extensions(line: &str) -> Vec<String> {
    // /FE="*.c *.h *.cpp"
    if let Some(q1) = line.find('"') {
        if let Some(q2) = line[q1 + 1..].find('"') {
            return line[q1 + 1..q1 + 1 + q2]
                .split_whitespace()
                .map(|s| s.trim_start_matches("*.").to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }
    Vec::new()
}

/// Scan a directory for .uew files and return parsed definitions
pub fn load_wordfiles_from_dir(dir: &Path) -> Vec<WordfileDef> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("uew") {
                match parse_wordfile(&p) {
                    Ok(def) => result.push(def),
                    Err(e) => log::warn!("Failed to parse wordfile {:?}: {}", p, e),
                }
            }
        }
    }
    result
}
