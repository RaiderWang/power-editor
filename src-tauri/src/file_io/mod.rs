pub mod streaming;

use anyhow::{anyhow, Result};
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use ropey::Rope;
use std::fs;
use std::io::BufReader;
use std::path::Path;

use crate::buffer::{Buffer, BufferRegistry, LineEnding};

/// Detect the encoding of a byte slice (sample).
///
/// Strategy (optimised for CJK text):
///   1. Fast stdlib UTF-8 validation — if the sample is valid UTF-8, return UTF-8.
///   2. Feed up to 64 KB into chardetng for better CJK discrimination.
pub fn detect_encoding(bytes: &[u8]) -> &'static Encoding {
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    let mut det = EncodingDetector::new();
    let sample_size = bytes.len().min(65536);
    det.feed(&bytes[..sample_size], true);
    det.guess(None, true)
}

/// Detect the dominant line ending style in a string.
/// Still used by `decode_bytes` (in-memory path for `open_bytes`).
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

/// Decode raw bytes (already in memory) into a Rope.
/// Used by `open_bytes` for drag-and-drop / paste where the data is already in RAM.
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

/// Resolve the encoding for a byte sample, respecting BOM markers.
pub(crate) fn resolve_encoding(raw: &[u8]) -> &'static Encoding {
    if raw.starts_with(b"\xEF\xBB\xBF") {
        UTF_8
    } else if raw.starts_with(b"\xFF\xFE") {
        encoding_rs::UTF_16LE
    } else if raw.starts_with(b"\xFE\xFF") {
        encoding_rs::UTF_16BE
    } else {
        detect_encoding(raw)
    }
}

/// Open a file with streaming decode (auto-detect encoding).
/// Peak memory ≈ Rope size + a few MB read buffer, instead of 3–4× file size.
///
/// **Legacy single-pass open** — reads the *entire* file before returning.
/// Kept for `reload_file` / `reopen_with_encoding` where the caller explicitly
/// expects to wait.  For the primary `open_file` command, use [`open_file_quick`].
pub fn open_file(
    registry: &BufferRegistry,
    path: &Path,
    on_progress: impl FnMut(u64),
) -> Result<u64> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);

    let (rope, enc_name, line_ending) =
        streaming::decode_stream(reader, None, on_progress)?;

    let id = BufferRegistry::next_id();
    let total_bytes = fs::metadata(path).ok().map(|m| m.len()).unwrap_or(0);
    let mtime = fs::metadata(path).ok().and_then(|m| m.modified().ok());
    let mut buffer = Buffer::from_rope(id, rope, Some(path.to_path_buf()), enc_name, line_ending);
    buffer.mtime = mtime;
    buffer.file_total_bytes = total_bytes;
    registry.insert(buffer);

    Ok(id)
}

/// **Two-phase open — Phase 1.**
///
/// Reads only the first chunk (~4 MB), creates the buffer with a partial Rope,
/// and returns immediately.  If the file is larger than one chunk, a
/// [`streaming::StreamContinuation`] is returned for Phase 2 background loading.
pub(crate) fn open_file_quick(
    registry: &BufferRegistry,
    path: &Path,
) -> Result<(u64, Option<streaming::StreamContinuation>)> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);

    let (rope, enc_name, line_ending, continuation) =
        streaming::decode_stream_start(reader, None)?;

    let id = BufferRegistry::next_id();
    let total_bytes = fs::metadata(path).ok().map(|m| m.len()).unwrap_or(0);
    let mtime = fs::metadata(path).ok().and_then(|m| m.modified().ok());

    let mut buffer = Buffer::from_rope(id, rope, Some(path.to_path_buf()), enc_name, line_ending);
    buffer.mtime = mtime;
    buffer.file_total_bytes = total_bytes;
    buffer.is_fully_loaded = continuation.is_none();
    registry.insert(buffer);

    Ok((id, continuation))
}

/// Re-open a file with a user-specified encoding (streaming decode).
pub fn open_file_with_encoding(
    registry: &BufferRegistry,
    path: &Path,
    encoding_name: &str,
    on_progress: impl FnMut(u64),
) -> Result<u64> {
    let encoding = Encoding::for_label(encoding_name.as_bytes())
        .ok_or_else(|| anyhow!("Unknown encoding: {}", encoding_name))?;

    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);

    let (rope, enc_name, line_ending) =
        streaming::decode_stream(reader, Some(encoding), on_progress)?;

    let id = BufferRegistry::next_id();
    let buffer = Buffer::from_rope(id, rope, Some(path.to_path_buf()), enc_name, line_ending);
    registry.insert(buffer);
    Ok(id)
}

/// Reload a file from disk using streaming decode with a known encoding.
/// Returns `(rope, encoding_name, line_ending)` for the caller to update
/// the existing buffer in-place (preserving the same buffer ID).
pub fn reload_file(
    path: &Path,
    encoding: &'static Encoding,
    on_progress: impl FnMut(u64),
) -> Result<(Rope, String, LineEnding)> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    streaming::decode_stream(reader, Some(encoding), on_progress)
}

/// Open a file from raw bytes (for drag-and-drop or paste).
/// Data is already in memory so no streaming needed.
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

/// Only update the encoding label on the buffer.
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

/// Canonical encoding names as returned by encoding_rs.
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
        WINDOWS_1252,
        ISO_8859_2,
        WINDOWS_1251,
        KOI8_R,
    ]
    .iter()
    .map(|e| e.name().to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_encoding_bom_utf8() {
        let raw = b"\xEF\xBB\xBFHello";
        let enc = resolve_encoding(raw);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn test_resolve_encoding_bom_utf16le() {
        let raw = b"\xFF\xFEH\x00e\x00";
        let enc = resolve_encoding(raw);
        assert_eq!(enc, encoding_rs::UTF_16LE);
    }

    #[test]
    fn test_resolve_encoding_bom_utf16be() {
        let raw = b"\xFE\xFF\x00H\x00e";
        let enc = resolve_encoding(raw);
        assert_eq!(enc, encoding_rs::UTF_16BE);
    }

    #[test]
    fn test_resolve_encoding_no_bom_ascii() {
        let raw = b"plain ascii text without bom";
        let enc = resolve_encoding(raw);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn test_detect_encoding_utf8_cjk() {
        let raw = "测试中文字符串，无BOM".as_bytes();
        let enc = detect_encoding(raw);
        assert_eq!(enc, UTF_8);
    }

    #[test]
    fn test_detect_encoding_gbk() {
        let text = "这是一段用于测试字符编码检测的中文简体文本，包含足够的字符供检测器准确判断。";
        let (gbk_bytes, _, _) = encoding_rs::GBK.encode(text);
        let enc = detect_encoding(&gbk_bytes);
        assert!(enc == encoding_rs::GBK || enc == encoding_rs::GB18030);
    }

    #[test]
    fn test_detect_line_ending_variants() {
        assert_eq!(detect_line_ending("a\nb\nc"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\r\nc"), LineEnding::CrLf);
        // crlf=1, lf=1 -> lf >= crlf -> Lf
        assert_eq!(detect_line_ending("a\r\nb\nc"), LineEnding::Lf);
        // crlf=2, lf=1 -> crlf > lf -> CrLf
        assert_eq!(detect_line_ending("a\r\nb\r\nc\n"), LineEnding::CrLf);
        // empty string defaults to Lf
        assert_eq!(detect_line_ending(""), LineEnding::Lf);
    }

    #[test]
    fn test_decode_bytes_utf8_crlf() {
        let raw = b"hello\r\nworld\r\n";
        let (rope, enc, le) = decode_bytes(raw, UTF_8);
        assert_eq!(rope.to_string(), "hello\nworld\n");
        assert_eq!(enc, "UTF-8");
        assert_eq!(le, LineEnding::CrLf);
    }

    #[test]
    fn test_decode_bytes_gbk() {
        let text = "你好，世界！";
        let (raw, _, _) = encoding_rs::GBK.encode(text);
        let (rope, enc, _) = decode_bytes(&raw, encoding_rs::GBK);
        assert_eq!(rope.to_string(), text);
        assert_eq!(enc, "GBK");
    }

    #[test]
    fn test_supported_encodings_contains_essentials() {
        let encs = supported_encodings();
        assert!(encs.contains(&"UTF-8".to_string()));
        assert!(encs.contains(&"GBK".to_string()));
        assert!(encs.contains(&"UTF-16LE".to_string()));
        assert!(encs.contains(&"Big5".to_string()) || encs.contains(&"BIG5".to_string()) || encs.iter().any(|e| e.to_lowercase() == "big5"));
    }

    #[test]
    fn test_change_encoding() {
        let registry = BufferRegistry::new();
        let id = BufferRegistry::next_id();
        let buf = Buffer::from_rope(id, Rope::from_str("content"), None, "UTF-8".into(), LineEnding::Lf);
        registry.insert(buf);

        assert!(change_encoding(&registry, id, "GBK").is_ok());
        {
            let buffers = registry.buffers.lock().unwrap();
            assert_eq!(buffers.get(&id).unwrap().encoding, "GBK");
            assert!(buffers.get(&id).unwrap().is_modified);
        }

        assert!(change_encoding(&registry, id, "INVALID_ENCODING").is_err());
        assert!(change_encoding(&registry, 999999, "UTF-8").is_err());
    }
}

