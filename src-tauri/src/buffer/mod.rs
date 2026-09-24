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
    /// `false` while a large file is still being loaded in the background.
    pub is_fully_loaded: bool,
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
    /// `false` while background loading is still in progress for large files.
    pub is_fully_loaded: bool,
    /// Total file size on disk (from `fs::metadata`).  Used in `file_info()` so
    /// the frontend shows the real file size even when the Rope is only partially
    /// loaded.
    pub file_total_bytes: u64,
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
            is_fully_loaded: true,
            file_total_bytes: 0,
        }
    }

    pub fn file_info(&self) -> FileInfo {
        // When the buffer is still loading, report the on-disk file size so the
        // frontend shows the real total rather than the partially-loaded amount.
        let total_bytes = if self.file_total_bytes > 0 {
            self.file_total_bytes
        } else {
            self.rope.len_bytes() as u64
        };
        let total_lines = self.rope.len_lines();
        FileInfo {
            id: self.id,
            path: self.path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            total_lines,
            total_bytes,
            encoding: self.encoding.clone(),
            line_ending: self.line_ending.as_str().to_string(),
            is_modified: self.is_modified,
            is_fully_loaded: self.is_fully_loaded,
        }
    }

    /// Return lines [start_line, start_line + count) (0-indexed)
    pub fn get_lines(&self, start_line: usize, count: usize) -> LineChunk {
        let total_lines = self.rope.len_lines();
        // Clamp start_line to the file length to avoid usize underflow when
        // computing (end_line - start_line) below.  This can happen when an
        // external file change shrinks the file while the frontend window was
        // positioned beyond the new end-of-file.
        let start_line = start_line.min(total_lines);
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
    ///
    /// Streams line-by-line to disk via `BufWriter`, so peak memory is roughly
    /// one line's worth instead of the entire file.
    pub fn save(&mut self) -> Result<()> {
        let path = self.path.as_ref().context("No path set for buffer")?;

        let encoding = Encoding::for_label(self.encoding.as_bytes())
            .unwrap_or(encoding_rs::UTF_8);

        let line_ending_bytes: &[u8] = match self.line_ending {
            LineEnding::CrLf => b"\r\n",
            _ => b"\n",
        };

        let dir = path.parent().unwrap_or(std::path::Path::new("."));
        let tmp = tempfile::NamedTempFile::new_in(dir)?;
        {
            let mut writer = BufWriter::new(tmp.as_file());
            let total = self.rope.len_lines();
            for (i, line) in self.rope.lines().enumerate() {
                let s = line.to_string();
                let s = s.trim_end_matches('\n').trim_end_matches('\r');
                let (encoded, _, _) = encoding.encode(s);
                writer.write_all(&encoded)?;
                if i + 1 < total {
                    writer.write_all(line_ending_bytes)?;
                }
            }
            writer.flush()?;
        }

        tmp.persist(path)?;
        self.is_modified = false;
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

    /// Convert all line endings in the rope to the target style.
    ///
    /// Rebuilds the rope via `RopeBuilder` line-by-line instead of materialising
    /// the entire document as a `String`, keeping peak memory at O(single line).
    pub fn convert_line_endings(&mut self, target: LineEnding) {
        let target_le: &str = match target {
            LineEnding::CrLf => "\r\n",
            _ => "\n",
        };

        let total = self.rope.len_lines();
        let mut builder = ropey::RopeBuilder::new();
        for (i, line) in self.rope.lines().enumerate() {
            let s = line.to_string();
            let s = s.trim_end_matches('\n').trim_end_matches('\r');
            builder.append(s);
            if i + 1 < total {
                builder.append(target_le);
            }
        }
        self.rope = builder.finish();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer(text: &str) -> Buffer {
        Buffer::from_rope(1, Rope::from_str(text), None, "UTF-8".into(), LineEnding::Lf)
    }

    #[test]
    fn test_get_lines_byte_offsets_ascii() {
        let buf = make_buffer("hello\nworld\nfoo\n");
        let chunk = buf.get_lines(1, 1);
        assert_eq!(chunk.lines, vec!["world"]);
        assert_eq!(chunk.start_byte_offset, 6);
        assert_eq!(chunk.end_byte_offset, 12);
        assert_eq!(chunk.total_lines, 4);
    }

    #[test]
    fn test_get_lines_byte_offsets_cjk() {
        // "你好\n" = 3 + 3 + 1 = 7 bytes
        // "世界\n" = 3 + 3 + 1 = 7 bytes
        let buf = make_buffer("你好\n世界\n");
        let chunk = buf.get_lines(1, 1);
        assert_eq!(chunk.lines, vec!["世界"]);
        assert_eq!(chunk.start_byte_offset, 7);
        assert_eq!(chunk.end_byte_offset, 14);
    }

    #[test]
    fn test_get_lines_byte_offsets_emoji_4byte() {
        // "😀\n" = 4 + 1 = 5 bytes
        // "ABC\n" = 3 + 1 = 4 bytes
        let buf = make_buffer("😀\nABC\n");
        let chunk = buf.get_lines(1, 1);
        assert_eq!(chunk.lines, vec!["ABC"]);
        assert_eq!(chunk.start_byte_offset, 5);
        assert_eq!(chunk.end_byte_offset, 9);
    }

    #[test]
    fn test_get_lines_byte_offsets_mixed_multibyte() {
        // "a你b\n" = 1 + 3 + 1 + 1 = 6 bytes
        // "C\n"    = 1 + 1 = 2 bytes
        let buf = make_buffer("a你b\nC\n");
        let chunk0 = buf.get_lines(0, 1);
        assert_eq!(chunk0.lines, vec!["a你b"]);
        assert_eq!(chunk0.start_byte_offset, 0);
        assert_eq!(chunk0.end_byte_offset, 6);

        let chunk1 = buf.get_lines(1, 1);
        assert_eq!(chunk1.lines, vec!["C"]);
        assert_eq!(chunk1.start_byte_offset, 6);
        assert_eq!(chunk1.end_byte_offset, 8);
    }

    #[test]
    fn test_get_lines_start_beyond_eof() {
        let buf = make_buffer("line1\nline2\n");
        let total_bytes = buf.rope.len_bytes();
        let chunk = buf.get_lines(999, 10);
        assert!(chunk.lines.is_empty());
        assert_eq!(chunk.start_byte_offset, total_bytes);
        assert_eq!(chunk.end_byte_offset, total_bytes);
    }

    #[test]
    fn test_get_lines_count_beyond_eof() {
        let buf = make_buffer("line1\nline2");
        let total_bytes = buf.rope.len_bytes();
        let chunk = buf.get_lines(1, 100);
        assert_eq!(chunk.lines, vec!["line2"]);
        assert_eq!(chunk.start_line, 1);
        assert_eq!(chunk.end_byte_offset, total_bytes);
    }

    #[test]
    fn test_get_lines_empty_rope() {
        let buf = make_buffer("");
        let chunk = buf.get_lines(0, 10);
        assert_eq!(chunk.start_byte_offset, 0);
        assert_eq!(chunk.end_byte_offset, 0);
    }

    #[test]
    fn test_get_lines_single_line_no_trailing_newline() {
        let buf = make_buffer("hello");
        let chunk = buf.get_lines(0, 1);
        assert_eq!(chunk.lines, vec!["hello"]);
        assert_eq!(chunk.start_byte_offset, 0);
        assert_eq!(chunk.end_byte_offset, 5);
        assert_eq!(chunk.total_lines, 1);
    }

    #[test]
    fn test_apply_edit_middle_ascii() {
        let mut buf = make_buffer("aaabbbccc");
        buf.apply_edit(&EditOp {
            from: 3,
            to: 6,
            text: "XXX".into(),
        })
        .unwrap();
        assert_eq!(buf.get_full_text(), "aaaXXXccc");
        assert!(buf.is_modified);
    }

    #[test]
    fn test_apply_edit_cjk_bytes() {
        // "你好世界": "你好" = bytes 0..6, "世界" = bytes 6..12
        let mut buf = make_buffer("你好世界");
        buf.apply_edit(&EditOp {
            from: 6,
            to: 12,
            text: "地球".into(),
        })
        .unwrap();
        assert_eq!(buf.get_full_text(), "你好地球");
    }

    #[test]
    fn test_apply_edit_insert_only() {
        let mut buf = make_buffer("world");
        buf.apply_edit(&EditOp {
            from: 0,
            to: 0,
            text: "hello ".into(),
        })
        .unwrap();
        assert_eq!(buf.get_full_text(), "hello world");
    }

    #[test]
    fn test_apply_edit_full_replace() {
        let mut buf = make_buffer("old content across multiple lines\nline 2");
        buf.apply_edit(&EditOp {
            from: 0,
            to: usize::MAX,
            text: "entirely new content".into(),
        })
        .unwrap();
        assert_eq!(buf.get_full_text(), "entirely new content");
    }

    #[test]
    fn test_apply_edit_out_of_bounds_clamp() {
        let mut buf = make_buffer("abc");
        buf.apply_edit(&EditOp {
            from: 100,
            to: 200,
            text: "def".into(),
        })
        .unwrap();
        assert_eq!(buf.get_full_text(), "abcdef");
    }

    #[test]
    fn test_convert_line_endings_lf_to_crlf_and_back() {
        let mut buf = make_buffer("line1\nline2\nline3");
        buf.convert_line_endings(LineEnding::CrLf);
        assert_eq!(buf.line_ending, LineEnding::CrLf);
        assert_eq!(buf.get_full_text(), "line1\r\nline2\r\nline3");
        assert_eq!(buf.rope.len_lines(), 3);

        buf.convert_line_endings(LineEnding::Lf);
        assert_eq!(buf.line_ending, LineEnding::Lf);
        assert_eq!(buf.get_full_text(), "line1\nline2\nline3");
        assert_eq!(buf.rope.len_lines(), 3);
    }
}

