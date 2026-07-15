use anyhow::{Context, Result};
use encoding_rs::Encoding;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Metadata returned when a file is opened
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub id: u64,
    pub path: String,
    pub total_lines: usize,
    pub total_bytes: u64,
    pub encoding: String,
    pub line_ending: String,
    pub is_modified: bool,
}

/// A chunk of text lines returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineChunk {
    pub start_line: usize,
    pub lines: Vec<String>,
    pub total_lines: usize,
    /// UTF-8 byte offset of the first character of `start_line` in the full rope.
    /// Used by the frontend to map Rust search-match byte offsets into the
    /// currently loaded virtual-document window.
    pub start_byte_offset: usize,
    /// UTF-8 byte offset of the first character of the line *after* the last
    /// loaded line (i.e., the exclusive end of this chunk in the rope).
    /// Equals `rope.len_bytes()` when this chunk reaches the end of the file.
    pub end_byte_offset: usize,
}

/// Edit operation from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditOp {
    /// Byte offset from start of document
    pub from: usize,
    /// Byte offset end of range to replace
    pub to: usize,
    /// Replacement text
    pub text: String,
}

/// Open buffer state
pub struct Buffer {
    pub id: u64,
    pub path: Option<PathBuf>,
    pub rope: Rope,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub is_modified: bool,
    /// Modification time of the file on disk at the time it was last read or saved.
    /// Used to suppress self-save watcher events.
    pub mtime: Option<SystemTime>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LineEnding {
    Lf,
    CrLf,
    Mixed,
}

impl LineEnding {
    pub fn as_str(&self) -> &'static str {
        match self {
            LineEnding::Lf => "LF",
            LineEnding::CrLf => "CRLF",
            LineEnding::Mixed => "Mixed",
        }
    }
}

impl Buffer {
    pub fn from_rope(id: u64, rope: Rope, path: Option<PathBuf>, encoding: String, line_ending: LineEnding) -> Self {
        Buffer {
            id,
            path,
            rope,
            encoding,
            line_ending,
            is_modified: false,
            mtime: None,
        }
    }

    pub fn file_info(&self) -> FileInfo {
        let total_bytes = self.rope.len_bytes() as u64;
        let total_lines = self.rope.len_lines();
        FileInfo {
            id: self.id,
            path: self.path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            total_lines,
            total_bytes,
            encoding: self.encoding.clone(),
            line_ending: self.line_ending.as_str().to_string(),
            is_modified: self.is_modified,
        }
    }

    /// Return lines [start_line, start_line + count) (0-indexed)
    pub fn get_lines(&self, start_line: usize, count: usize) -> LineChunk {
        let total_lines = self.rope.len_lines();
        let end_line = (start_line + count).min(total_lines);
        let mut lines = Vec::with_capacity(end_line - start_line);

        for line_idx in start_line..end_line {
            let line = self.rope.line(line_idx);
            // Strip trailing \r\n or \n
            let s = line.to_string();
            let s = s.trim_end_matches('\n').trim_end_matches('\r');
            lines.push(s.to_string());
        }

        // Compute byte offsets via char index (ropey has no direct line_to_byte).
        let start_byte_offset = if start_line < total_lines {
            self.rope.char_to_byte(self.rope.line_to_char(start_line))
        } else {
            self.rope.len_bytes()
        };
        let end_byte_offset = if end_line < total_lines {
            self.rope.char_to_byte(self.rope.line_to_char(end_line))
        } else {
            self.rope.len_bytes()
        };

        LineChunk {
            start_line,
            lines,
            total_lines,
            start_byte_offset,
            end_byte_offset,
        }
    }

    /// Apply an edit operation (from_byte..to_byte replaced with text)
    pub fn apply_edit(&mut self, op: &EditOp) -> Result<()> {
        let from_char = self.rope.byte_to_char(op.from.min(self.rope.len_bytes()));
        let to_char = self.rope.byte_to_char(op.to.min(self.rope.len_bytes()));

        if from_char < to_char {
            self.rope.remove(from_char..to_char);
        }
        if !op.text.is_empty() {
            self.rope.insert(from_char, &op.text);
        }
        self.is_modified = true;
        Ok(())
    }

    /// Save buffer to its path, encoding content with `self.encoding`.
    pub fn save(&mut self) -> Result<()> {
        let path = self.path.as_ref().context("No path set for buffer")?;

        let encoding = Encoding::for_label(self.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);

        let line_ending_str: &str = match self.line_ending {
            LineEnding::CrLf => "\r\n",
            _ => "\n",
        };

        // Build the full content string first, then encode once with the target encoding.
        let total = self.rope.len_lines();
        let mut content = String::with_capacity(self.rope.len_bytes());
        for (i, line) in self.rope.lines().enumerate() {
            let s = line.to_string();
            let s = s.trim_end_matches('\n').trim_end_matches('\r');
            content.push_str(s);
            if i + 1 < total {
                content.push_str(line_ending_str);
            }
        }

        let (encoded, _, _) = encoding.encode(&content);

        // Write to a temp file then rename for atomic save.
        let dir = path.parent().unwrap_or(std::path::Path::new("."));
        let tmp = tempfile::NamedTempFile::new_in(dir)?;
        {
            let mut writer = BufWriter::new(tmp.as_file());
            writer.write_all(&encoded)?;
            writer.flush()?;
        }

        tmp.persist(path)?;
        self.is_modified = false;
        // Record mtime so the file-watcher can suppress the resulting event.
        self.mtime = std::fs::metadata(path).ok().and_then(|m| m.modified().ok());
        Ok(())
    }

    /// Save to a new path
    pub fn save_as(&mut self, new_path: PathBuf) -> Result<()> {
        self.path = Some(new_path);
        self.save()
    }

    /// Rename the file on disk (same directory, new base name).
    pub fn rename(&mut self, new_name: &str) -> Result<()> {
        let old_path = self
            .path
            .as_ref()
            .context("Buffer has no path")?
            .clone();
        if !old_path.exists() {
            anyhow::bail!("File not found on disk");
        }
        let parent = old_path
            .parent()
            .context("Cannot determine parent directory")?;
        let new_path = parent.join(new_name);
        if new_path.exists() {
            anyhow::bail!("A file named \"{}\" already exists", new_name);
        }
        std::fs::rename(&old_path, &new_path).context("Failed to rename file")?;
        self.path = Some(new_path);
        Ok(())
    }

    /// Return the full rope content as a single string.
    /// Ropey normalises line endings to `\n` internally, which matches
    /// the frontend `getLines().join('\n')` convention.
    pub fn get_full_text(&self) -> String {
        self.rope.to_string()
    }

    /// Convert all line endings in the rope to the target style
    pub fn convert_line_endings(&mut self, target: LineEnding) {
        let content = self.rope.to_string();
        // Normalize to LF first, then convert to target
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        let converted = match target {
            LineEnding::CrLf => normalized.replace('\n', "\r\n"),
            _ => normalized,
        };
        self.rope = Rope::from_str(&converted);
        self.line_ending = target;
        self.is_modified = true;
    }
}

/// Global buffer registry (buffer_id -> Buffer), protected by a mutex
pub struct BufferRegistry {
    pub buffers: Mutex<HashMap<u64, Buffer>>,
}

impl BufferRegistry {
    pub fn new() -> Self {
        BufferRegistry {
            buffers: Mutex::new(HashMap::new()),
        }
    }

    pub fn next_id() -> u64 {
        NEXT_ID.fetch_add(1, Ordering::SeqCst)
    }

    pub fn insert(&self, buffer: Buffer) -> u64 {
        let id = buffer.id;
        self.buffers.lock().unwrap().insert(id, buffer);
        id
    }

    pub fn remove(&self, id: u64) {
        self.buffers.lock().unwrap().remove(&id);
    }
}
