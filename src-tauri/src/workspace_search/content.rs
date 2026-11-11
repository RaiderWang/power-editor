//! Streaming content scanner for one file.
//!
//! The decode path mirrors the editor's loader (`file_io::streaming::decode_stream_start`)
//! so that the reported byte offsets are exactly the Rope's coordinates:
//!
//! * encoding = `resolve_encoding` over the first (up to 4 MB) read,
//! * one stateful `Decoder` with BOM removal (BOM bytes are not part of the offsets),
//! * `\r\n` / lone `\r` normalised to `\n`.
//!
//! Chunking happens on the *decoded* text: raw 4 MB reads are decoded (the decoder keeps
//! multi-byte / surrogate state across reads), appended to a `carry` string, and scanned up to
//! the last line break; the rest stays in `carry`. Memory is therefore bounded by the chunk
//! size regardless of the file size, for every encoding.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};

use encoding_rs::{Decoder, Encoding};
use regex::Regex;

use super::preview::{build_preview, normalize_newlines};
use super::types::LineHit;
use crate::file_io::{is_binary_sample, resolve_encoding};

/// Size of one raw read (same as the loader's).
pub const READ_SIZE: usize = 4 * 1024 * 1024;
/// Longest un-broken text kept in memory before the scanner cuts a line by force.
pub const MAX_CARRY: usize = 8 * 1024 * 1024;
/// Matching lines reported per file.
pub const MAX_HITS_PER_FILE: usize = 200;
/// Bytes sniffed for the binary check (same as `check_file_metadata`).
const BINARY_SNIFF: usize = 8192;

#[derive(Debug, Clone, Copy)]
pub struct ScanConfig {
    pub read_size: usize,
    pub max_carry: usize,
    pub max_hits: usize,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            read_size: READ_SIZE,
            max_carry: MAX_CARRY,
            max_hits: MAX_HITS_PER_FILE,
        }
    }
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub binary: bool,
    pub encoding: String,
    pub hits: Vec<LineHit>,
    /// More matching lines than `max_hits`.
    pub more: bool,
    /// Lines cut by force because they exceeded `max_carry`.
    pub long_cuts: u64,
}

/// Fill `buf` as far as possible; fewer bytes than `buf.len()` only at EOF.
fn read_fill(reader: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut total = 0;
    while total < buf.len() {
        match reader.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => total += n,
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

fn decode_into(decoder: &mut Decoder, mut input: &[u8], is_last: bool, out: &mut String) {
    loop {
        let max = decoder
            .max_utf8_buffer_length(input.len())
            .unwrap_or(input.len() * 4 + 64);
        out.reserve(max);
        let (result, read, _had_errors) = decoder.decode_to_string(input, out, is_last);
        input = &input[read..];
        if let encoding_rs::CoderResult::InputEmpty = result {
            break;
        }
    }
}

/// Where to cut `text` so that only whole lines are scanned. Returns `(cut, forced)`;
/// `cut == 0` means "no complete line yet, wait for more input".
fn find_cut(text: &str, max_carry: usize) -> (usize, bool) {
    let bytes = text.as_bytes();
    // A trailing `\r` may be the first half of a `\r\n` split across reads.
    let limit = if bytes.last() == Some(&b'\r') { bytes.len() - 1 } else { bytes.len() };
    if let Some(i) = memchr::memrchr2(b'\n', b'\r', &bytes[..limit]) {
        return (i + 1, false);
    }
    if text.len() > max_carry {
        let mut cut = max_carry.min(limit);
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        return (cut, true);
    }
    (0, false)
}

struct Scanner<'a> {
    re: &'a Regex,
    max_hits: usize,
    /// Bytes of normalised text already scanned (offset base of the next block).
    base: usize,
    /// Number of `\n` in the already scanned text (= 0-based line of the next block).
    line: u64,
    hits: Vec<LineHit>,
    more: bool,
}

impl Scanner<'_> {
    /// Scan a block of whole lines. Returns `false` once the per-file cap is reached.
    ///
    /// `is_last` marks the final block of the file. Zero-width matches (`^$`, `^`, `$`,
    /// `\b`) are real hits, but a zero-width match at the very end of a *non-last* block is
    /// the start of the next block (or a forced mid-line cut) and must not be reported twice.
    fn scan_block(&mut self, raw: &str, is_last: bool) -> bool {
        let normalized = normalize_newlines(raw);
        let text: &str = &normalized;
        let bytes = text.as_bytes();

        let mut cursor = 0usize;
        let mut line = self.line;
        let mut skip_until = 0usize;
        let mut keep_going = true;

        for m in self.re.find_iter(text) {
            if m.start() < skip_until {
                continue;
            }
            if !is_last && m.start() == text.len() && !text.is_empty() {
                continue;
            }
            if self.hits.len() >= self.max_hits {
                self.more = true;
                keep_going = false;
                break;
            }
            line += memchr::memchr_iter(b'\n', &bytes[cursor..m.start()]).count() as u64;
            cursor = m.start();

            let line_start = memchr::memrchr(b'\n', &bytes[..m.start()]).map_or(0, |i| i + 1);
            let line_end = memchr::memchr(b'\n', &bytes[m.start()..]).map_or(text.len(), |i| m.start() + i);
            // One hit per line. `+ 1` skips the `\n` itself so a zero-width match at
            // `line_end` (e.g. `$`) after a non-empty hit is not a second hit on this line.
            skip_until = line_end + 1;
            let m_end = m.end().min(line_end);
            let preview = build_preview(text, line_start, line_end, m.start(), m_end);
            self.hits.push(LineHit {
                line,
                from: (self.base + m.start()) as u64,
                to: (self.base + m_end) as u64,
                preview: preview.text,
                hl_start: preview.hl_start,
                hl_end: preview.hl_end,
            });
        }

        self.line += memchr::memchr_iter(b'\n', bytes).count() as u64;
        self.base += text.len();
        keep_going
    }
}

/// Scan `reader` (a file of `len` bytes). `forced_encoding` bypasses detection (tests).
pub fn scan_reader(
    reader: &mut impl Read,
    len: u64,
    re: &Regex,
    cancel: &AtomicBool,
    cfg: &ScanConfig,
    forced_encoding: Option<&'static Encoding>,
) -> std::io::Result<ScanResult> {
    let mut result = ScanResult::default();
    if len == 0 {
        result.encoding = "UTF-8".to_string();
        return Ok(result);
    }

    // The first read doubles as the encoding sample, like the loader's first 4 MB chunk.
    let buf_size = (len.min(cfg.read_size as u64) as usize).max(1);
    let mut raw = vec![0u8; buf_size];
    let mut n = read_fill(reader, &mut raw)?;
    let mut total_read = n as u64;
    if n == 0 {
        result.encoding = "UTF-8".to_string();
        return Ok(result);
    }
    if is_binary_sample(&raw[..n.min(BINARY_SNIFF)]) {
        result.binary = true;
        return Ok(result);
    }

    let encoding = forced_encoding.unwrap_or_else(|| resolve_encoding(&raw[..n]));
    result.encoding = encoding.name().to_string();
    let mut decoder = encoding.new_decoder_with_bom_removal();

    let mut scanner = Scanner {
        re,
        max_hits: cfg.max_hits,
        base: 0,
        line: 0,
        hits: Vec::new(),
        more: false,
    };
    let mut carry = String::new();

    loop {
        let is_last = n < raw.len() || total_read >= len;
        decode_into(&mut decoder, &raw[..n], is_last, &mut carry);

        if is_last {
            scanner.scan_block(&carry, true);
            break;
        }
        let (cut, forced) = find_cut(&carry, cfg.max_carry);
        if cut > 0 {
            if forced {
                result.long_cuts += 1;
            }
            let keep_going = scanner.scan_block(&carry[..cut], false);
            carry.drain(..cut);
            if !keep_going {
                break;
            }
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        n = read_fill(reader, &mut raw)?;
        total_read += n as u64;
    }

    result.hits = scanner.hits;
    result.more = scanner.more;
    Ok(result)
}

/// Open and scan a file on disk.
pub fn scan_file(path: &std::path::Path, re: &Regex, cancel: &AtomicBool) -> std::io::Result<ScanResult> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    scan_reader(&mut file, len, re, cancel, &ScanConfig::default(), None)
}
