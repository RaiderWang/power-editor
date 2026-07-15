use anyhow::{anyhow, Result};
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use ropey::Rope;
use std::fs;
use std::path::Path;

use crate::buffer::{Buffer, BufferRegistry, LineEnding};

/// Detect the encoding of a byte slice.
///
/// Strategy (optimised for CJK text):
///   1. Fast stdlib UTF-8 validation — if the whole buffer is valid UTF-8, return UTF-8.
///   2. Feed up to 64 KB (vs old 8 KB) into chardetng for better CJK discrimination.
///
/// Large-file note: the bytes are already in RAM at this point (loaded by `fs::read`),
/// so the UTF-8 check is an O(n) scan over already-hot memory and adds no extra I/O.
pub fn detect_encoding(bytes: &[u8]) -> &'static Encoding {
    // Step 1: if the entire content is valid UTF-8, no need for chardetng.
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }

    // Step 2: chardetng with a 64 KB sample (8× larger than before).
    // For CJK double-byte encodings (GBK, Big5, EUC-*), chardetng needs
    // enough character pairs to distinguish them from Latin single-byte encodings.
    let mut det = EncodingDetector::new();
    let sample_size = bytes.len().min(65536);
    det.feed(&bytes[..sample_size], true);
    det.guess(None, true)
}

/// Detect the dominant line ending style in a string.
pub fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count().saturating_sub(crlf);
    let cr = text.matches('\r').count().saturating_sub(crlf);

    if crlf == 0 && cr == 0 {
        return LineEnding::Lf;
    }
    if lf == 0 && cr == 0 {
        return LineEnding::CrLf;
    }
    if crlf > lf && crlf > cr {
        LineEnding::CrLf
    } else if lf >= crlf {
        LineEnding::Lf
    } else {
        LineEnding::Mixed
    }
}

/// Decode raw bytes into a Rope, returning (rope, canonical_encoding_name, line_ending).
pub fn decode_bytes(raw: &[u8], encoding: &'static Encoding) -> (Rope, String, LineEnding) {
    let (decoded, _, had_errors) = encoding.decode(raw);
    if had_errors {
        log::warn!(
            "Encoding errors while decoding as {}; some characters may be replaced",
            encoding.name()
        );
    }
    let text: &str = &decoded;
    let line_ending = detect_line_ending(text);
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let rope = Rope::from_str(&normalized);
    (rope, encoding.name().to_string(), line_ending)
}

/// Resolve the encoding for raw bytes, respecting BOM markers.
fn resolve_encoding(raw: &[u8]) -> &'static Encoding {
    if raw.starts_with(b"\xEF\xBB\xBF") {
        UTF_8
    } else if raw.starts_with(b"\xFF\xFE") {
        encoding_rs::UTF_16LE
    } else if raw.starts_with(b"\xFE\xFF") {
        // Fixed: FE FF is UTF-16 Big Endian BOM (was incorrectly mapped to LE before)
        encoding_rs::UTF_16BE
    } else {
        detect_encoding(raw)
    }
}

/// Open a file, auto-detect encoding and line endings, create a Buffer.
pub fn open_file(registry: &BufferRegistry, path: &Path) -> Result<u64> {
    let raw = fs::read(path)?;

    let encoding = resolve_encoding(&raw);

    let (rope, enc_name, line_ending) = decode_bytes(&raw, encoding);

    let id = BufferRegistry::next_id();
    let mtime = fs::metadata(path).ok().and_then(|m| m.modified().ok());
    let mut buffer = Buffer::from_rope(id, rope, Some(path.to_path_buf()), enc_name, line_ending);
    buffer.mtime = mtime;
    registry.insert(buffer);

    Ok(id)
}

/// Re-open an existing buffer's file with a user-specified encoding.
/// Creates a new buffer (new ID) so the editor reloads content automatically.
/// The old buffer must be removed by the caller after this succeeds.
pub fn open_file_with_encoding(
    registry: &BufferRegistry,
    path: &Path,
    encoding_name: &str,
) -> Result<u64> {
    let raw = fs::read(path)?;
    let encoding = Encoding::for_label(encoding_name.as_bytes())
        .ok_or_else(|| anyhow!("Unknown encoding: {}", encoding_name))?;
    let (rope, enc_name, line_ending) = decode_bytes(&raw, encoding);
    let id = BufferRegistry::next_id();
    let buffer = Buffer::from_rope(id, rope, Some(path.to_path_buf()), enc_name, line_ending);
    registry.insert(buffer);
    Ok(id)
}

/// Open a file from raw bytes (for drag-and-drop or paste).
pub fn open_bytes(
    registry: &BufferRegistry,
    bytes: Vec<u8>,
    path: Option<std::path::PathBuf>,
) -> Result<u64> {
    let encoding = detect_encoding(&bytes);
    let (rope, enc_name, line_ending) = decode_bytes(&bytes, encoding);
    let id = BufferRegistry::next_id();
    let buffer = Buffer::from_rope(id, rope, path, enc_name, line_ending);
    registry.insert(buffer);
    Ok(id)
}

/// Only update the encoding label on the buffer (for "save as different encoding" use case).
/// Does NOT re-decode content from disk.
pub fn change_encoding(
    registry: &BufferRegistry,
    buffer_id: u64,
    new_encoding_name: &str,
) -> Result<()> {
    let mut buffers = registry.buffers.lock().unwrap();
    let buffer = buffers
        .get_mut(&buffer_id)
        .ok_or_else(|| anyhow!("Buffer {} not found", buffer_id))?;

    let new_enc = Encoding::for_label(new_encoding_name.as_bytes())
        .ok_or_else(|| anyhow!("Unknown encoding: {}", new_encoding_name))?;

    buffer.encoding = new_enc.name().to_string();
    buffer.is_modified = true;
    Ok(())
}

/// Canonical encoding names as returned by encoding_rs — these must match exactly
/// what encoding_rs uses as canonical names so the toolbar <select> value always aligns.
pub fn supported_encodings() -> Vec<String> {
    use encoding_rs::*;
    [
        UTF_8,
        UTF_16LE,
        UTF_16BE,
        GBK,
        GB18030,
        BIG5,
        SHIFT_JIS,
        EUC_JP,
        EUC_KR,
        WINDOWS_1252, // canonical; "ISO-8859-1" is an alias for the same encoding
        ISO_8859_2,
        WINDOWS_1251,
        KOI8_R,
    ]
    .iter()
    .map(|e| e.name().to_string())
    .collect()
}
