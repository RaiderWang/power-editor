use anyhow::Result;
use encoding_rs::Encoding;
use ropey::{Rope, RopeBuilder};
use std::io::{BufReader, Read};

use crate::buffer::LineEnding;

/// Size of the raw-byte read buffer (4 MB).
const READ_BUF_SIZE: usize = 4 * 1024 * 1024;

/// Fill `buf` as completely as possible, returning the number of bytes read.
/// Returns fewer than `buf.len()` only at true EOF.
fn read_chunk(reader: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
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

// ──────────────────────────────────────────────────────────────
// CRLF normalisation state machine
// ──────────────────────────────────────────────────────────────

/// Tracks cross-chunk `\r` state and accumulates line-ending counts while
/// normalising `\r\n` / lone `\r` to `\n` for the Rope.
pub(crate) struct CrlfNormState {
    pending_cr: bool,
    crlf_count: usize,
    lf_count: usize,
    cr_count: usize,
}

impl CrlfNormState {
    fn new() -> Self {
        Self {
            pending_cr: false,
            crlf_count: 0,
            lf_count: 0,
            cr_count: 0,
        }
    }

    /// Process a decoded text chunk: normalise line endings and append to `builder`.
    ///
    /// Uses SIMD-accelerated `memchr` slice scanning to bulk-copy clean text
    /// between line breaks, avoiding character-by-character iterations.
    /// This makes CRLF normalisation orders of magnitude faster (gigabytes/sec).
    fn normalize_and_append(&mut self, input: &str, builder: &mut RopeBuilder) {
        if input.is_empty() && !self.pending_cr {
            return;
        }

        let bytes = input.as_bytes();
        let mut cursor = 0;

        // Fast path for non-CR chunks when no CR is pending across chunks
        if !self.pending_cr && memchr::memchr(b'\r', bytes).is_none() {
            self.lf_count += memchr::memchr_iter(b'\n', bytes).count();
            if !input.is_empty() {
                builder.append(input);
            }
            return;
        }

        let mut output = String::with_capacity(input.len() + 1);

        // ── Handle cross-chunk pending `\r` ──
        if self.pending_cr {
            if input.is_empty() {
                return;
            }
            if bytes[0] == b'\n' {
                // CRLF split across chunk boundary: output single '\n'
                self.crlf_count += 1;
                self.pending_cr = false;
                output.push('\n');
                cursor = 1;
            } else {
                // Lone CR at end of previous chunk: output '\n'
                self.cr_count += 1;
                self.pending_cr = false;
                output.push('\n');
            }
        }

        // ── Fast slice-based scan for `\r` ──
        while cursor < bytes.len() {
            match memchr::memchr(b'\r', &bytes[cursor..]) {
                Some(rel_idx) => {
                    let cr_idx = cursor + rel_idx;

                    // Bulk-copy the clean slice before the CR
                    if cr_idx > cursor {
                        let clean_slice = &input[cursor..cr_idx];
                        self.lf_count += memchr::memchr_iter(b'\n', clean_slice.as_bytes()).count();
                        output.push_str(clean_slice);
                    }

                    // Check if CR is at the very end of the chunk
                    if cr_idx + 1 == bytes.len() {
                        self.pending_cr = true;
                        break;
                    }

                    // Look at the character immediately after CR
                    if bytes[cr_idx + 1] == b'\n' {
                        // Standard CRLF: replace `\r\n` with a single `\n`
                        self.crlf_count += 1;
                        output.push('\n');
                        cursor = cr_idx + 2;
                    } else {
                        // Lone CR: replace with `\n`
                        self.cr_count += 1;
                        output.push('\n');
                        cursor = cr_idx + 1;
                    }
                }
                None => {
                    // No more CRs in remainder of chunk: bulk-copy the rest
                    let tail = &input[cursor..];
                    self.lf_count += memchr::memchr_iter(b'\n', tail.as_bytes()).count();
                    output.push_str(tail);
                    break;
                }
            }
        }

        if !output.is_empty() {
            builder.append(&output);
        }
    }

    /// Flush any trailing `\r` that was still pending when input ended.
    fn finish(&mut self, builder: &mut RopeBuilder) {
        if self.pending_cr {
            self.cr_count += 1;
            builder.append("\n");
            self.pending_cr = false;
        }
    }

    /// Determine the dominant line-ending style from accumulated counts.
    pub(crate) fn line_ending(&self) -> LineEnding {
        let (crlf, lf, cr) = (self.crlf_count, self.lf_count, self.cr_count);
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
}

// ──────────────────────────────────────────────────────────────
// Decode one raw-byte chunk through the encoding_rs Decoder
// ──────────────────────────────────────────────────────────────

fn decode_raw_chunk(
    decoder: &mut encoding_rs::Decoder,
    raw: &[u8],
    is_last: bool,
    decoded_buf: &mut String,
    builder: &mut RopeBuilder,
    state: &mut CrlfNormState,
) {
    let mut src_pos = 0;
    loop {
        let remaining = raw.len() - src_pos;
        let max_out = decoder
            .max_utf8_buffer_length(remaining)
            .unwrap_or(remaining * 4 + 64);
        let spare = decoded_buf.capacity() - decoded_buf.len();
        if spare < max_out {
            decoded_buf.reserve(max_out - spare);
        }

        let (result, consumed, had_errors) =
            decoder.decode_to_string(&raw[src_pos..], decoded_buf, is_last);
        src_pos += consumed;

        if had_errors {
            log::warn!("Encoding errors during streaming decode");
        }

        state.normalize_and_append(decoded_buf, builder);
        decoded_buf.clear();

        match result {
            encoding_rs::CoderResult::InputEmpty => break,
            encoding_rs::CoderResult::OutputFull => continue,
        }
    }
}

// ──────────────────────────────────────────────────────────────
// Two-phase streaming API
// ──────────────────────────────────────────────────────────────

/// State carried from Phase 1 to Phase 2 for background loading.
pub(crate) struct StreamContinuation {
    reader: BufReader<std::fs::File>,
    decoder: encoding_rs::Decoder,
    norm_state: CrlfNormState,
    /// Total raw bytes read so far (across all phases).
    pub(crate) bytes_read: u64,
    raw_buf: Vec<u8>,
    decoded_buf: String,
    finished: bool,
}

impl StreamContinuation {
    /// Final line-ending determination from all accumulated counts.
    /// Call after the decode loop has finished.
    pub(crate) fn final_line_ending(&self) -> LineEnding {
        self.norm_state.line_ending()
    }
}

/// **Phase 1** — Read the first chunk, detect encoding, build an initial Rope.
///
/// Returns `(rope, encoding_name, preliminary_line_ending, optional_continuation)`.
/// If the file fits in a single chunk, `continuation` is `None` and the Rope is
/// complete.  Otherwise the caller should feed the continuation to
/// [`decode_next_chunk`] in a background loop.
pub(crate) fn decode_stream_start(
    mut reader: BufReader<std::fs::File>,
    forced_encoding: Option<&'static Encoding>,
) -> Result<(Rope, String, LineEnding, Option<StreamContinuation>)> {
    let mut raw_buf = vec![0u8; READ_BUF_SIZE];

    let first_n = read_chunk(&mut reader, &mut raw_buf)?;
    if first_n == 0 {
        return Ok((
            Rope::from_str(""),
            "UTF-8".to_string(),
            LineEnding::Lf,
            None,
        ));
    }

    let encoding = forced_encoding.unwrap_or_else(|| super::resolve_encoding(&raw_buf[..first_n]));

    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut builder = RopeBuilder::new();
    let mut decoded_buf = String::new();
    let mut state = CrlfNormState::new();

    let is_complete = first_n < READ_BUF_SIZE;

    decode_raw_chunk(
        &mut decoder,
        &raw_buf[..first_n],
        is_complete,
        &mut decoded_buf,
        &mut builder,
        &mut state,
    );

    if is_complete {
        // Entire file fits in one chunk
        state.finish(&mut builder);
        let rope = builder.finish();
        let le = state.line_ending();
        Ok((rope, encoding.name().to_string(), le, None))
    } else {
        let rope = builder.finish();
        let le = state.line_ending(); // preliminary
        let cont = StreamContinuation {
            reader,
            decoder,
            norm_state: state,
            bytes_read: first_n as u64,
            raw_buf,
            decoded_buf,
            finished: false,
        };
        Ok((rope, encoding.name().to_string(), le, Some(cont)))
    }
}

/// **Phase 2** — Decode the next raw chunk and return a small `Rope` to append.
///
/// Returns `Some(rope)` for each chunk, or `None` when the file has been fully read
/// (after flushing the decoder and any pending CR).
pub(crate) fn decode_next_chunk(cont: &mut StreamContinuation) -> Result<Option<Rope>> {
    if cont.finished {
        return Ok(None);
    }

    let n = read_chunk(&mut cont.reader, &mut cont.raw_buf)?;
    if n == 0 {
        // EOF — flush decoder with empty input + is_last=true, then finish CR state
        cont.finished = true;
        let mut builder = RopeBuilder::new();
        decode_raw_chunk(
            &mut cont.decoder,
            &[],
            true,
            &mut cont.decoded_buf,
            &mut builder,
            &mut cont.norm_state,
        );
        cont.norm_state.finish(&mut builder);
        let rope = builder.finish();
        Ok(if rope.len_bytes() > 0 { Some(rope) } else { None })
    } else {
        cont.bytes_read += n as u64;
        let mut builder = RopeBuilder::new();
        decode_raw_chunk(
            &mut cont.decoder,
            &cont.raw_buf[..n],
            false,
            &mut cont.decoded_buf,
            &mut builder,
            &mut cont.norm_state,
        );
        let rope = builder.finish();
        Ok(if rope.len_bytes() > 0 { Some(rope) } else { None })
    }
}

// ──────────────────────────────────────────────────────────────
// Legacy single-pass API (used by reload / reopen_with_encoding)
// ──────────────────────────────────────────────────────────────

/// Streaming decode: read from `reader`, auto-detect (or use forced) encoding,
/// normalise line endings, and build a Rope incrementally.
///
/// Returns `(rope, canonical_encoding_name, line_ending)`.
pub fn decode_stream(
    mut reader: impl Read,
    forced_encoding: Option<&'static Encoding>,
    mut on_progress: impl FnMut(u64),
) -> Result<(Rope, String, LineEnding)> {
    let mut raw_buf = vec![0u8; READ_BUF_SIZE];

    let first_n = read_chunk(&mut reader, &mut raw_buf)?;
    if first_n == 0 {
        return Ok((Rope::from_str(""), "UTF-8".to_string(), LineEnding::Lf));
    }

    let encoding = forced_encoding.unwrap_or_else(|| super::resolve_encoding(&raw_buf[..first_n]));

    let mut decoder = encoding.new_decoder_with_bom_removal();
    let mut builder = RopeBuilder::new();
    let mut decoded_buf = String::new();
    let mut state = CrlfNormState::new();
    let mut total_bytes: u64 = 0;

    decode_raw_chunk(
        &mut decoder,
        &raw_buf[..first_n],
        false,
        &mut decoded_buf,
        &mut builder,
        &mut state,
    );
    total_bytes += first_n as u64;
    on_progress(total_bytes);

    loop {
        let n = read_chunk(&mut reader, &mut raw_buf)?;
        if n == 0 {
            decode_raw_chunk(&mut decoder, &[], true, &mut decoded_buf, &mut builder, &mut state);
            break;
        }
        total_bytes += n as u64;
        decode_raw_chunk(
            &mut decoder,
            &raw_buf[..n],
            false,
            &mut decoded_buf,
            &mut builder,
            &mut state,
        );
        on_progress(total_bytes);
    }

    state.finish(&mut builder);

    let rope = builder.finish();
    let line_ending = state.line_ending();
    Ok((rope, encoding.name().to_string(), line_ending))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crlf_split_across_chunks() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("hello\r", &mut builder);
        assert!(state.pending_cr);
        state.normalize_and_append("\nworld", &mut builder);
        assert!(!state.pending_cr);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "hello\nworld");
        assert_eq!(state.crlf_count, 1);
        assert_eq!(state.lf_count, 0);
        assert_eq!(state.cr_count, 0);
    }

    #[test]
    fn test_isolated_cr_across_chunks() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("hello\r", &mut builder);
        assert!(state.pending_cr);
        state.normalize_and_append("world", &mut builder);
        assert!(!state.pending_cr);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "hello\nworld");
        assert_eq!(state.cr_count, 1);
        assert_eq!(state.crlf_count, 0);
    }

    #[test]
    fn test_trailing_cr_at_end_of_stream() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("data\r", &mut builder);
        assert!(state.pending_cr);
        state.finish(&mut builder);
        assert!(!state.pending_cr);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "data\n");
        assert_eq!(state.cr_count, 1);
    }

    #[test]
    fn test_pure_lf_fast_path() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("line1\nline2\n", &mut builder);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "line1\nline2\n");
        assert_eq!(state.lf_count, 2);
        assert_eq!(state.crlf_count, 0);
        assert_eq!(state.cr_count, 0);
        assert_eq!(state.line_ending(), LineEnding::Lf);
    }

    #[test]
    fn test_pure_crlf() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("line1\r\nline2\r\n", &mut builder);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "line1\nline2\n");
        assert_eq!(state.crlf_count, 2);
        assert_eq!(state.lf_count, 0);
        assert_eq!(state.cr_count, 0);
        assert_eq!(state.line_ending(), LineEnding::CrLf);
    }

    #[test]
    fn test_mixed_line_endings_in_single_chunk() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("a\r\nb\nc\r", &mut builder);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "a\nb\nc\n");
        assert_eq!(state.crlf_count, 1);
        assert_eq!(state.lf_count, 1);
        assert_eq!(state.cr_count, 1);
    }

    #[test]
    fn test_empty_input() {
        let mut state = CrlfNormState::new();
        let mut builder = RopeBuilder::new();
        state.normalize_and_append("", &mut builder);
        state.finish(&mut builder);
        let rope = builder.finish();
        assert_eq!(rope.to_string(), "");
        assert_eq!(state.line_ending(), LineEnding::Lf);
    }

    #[test]
    fn test_line_ending_determination() {
        let mut state = CrlfNormState::new();
        assert_eq!(state.line_ending(), LineEnding::Lf);

        state.crlf_count = 5;
        state.lf_count = 0;
        state.cr_count = 0;
        assert_eq!(state.line_ending(), LineEnding::CrLf);

        state.crlf_count = 10;
        state.lf_count = 2;
        state.cr_count = 1;
        assert_eq!(state.line_ending(), LineEnding::CrLf);

        state.crlf_count = 5;
        state.lf_count = 10;
        state.cr_count = 1;
        assert_eq!(state.line_ending(), LineEnding::Lf);

        state.crlf_count = 5;
        state.lf_count = 5;
        state.cr_count = 1;
        assert_eq!(state.line_ending(), LineEnding::Lf);

        state.crlf_count = 2;
        state.lf_count = 1;
        state.cr_count = 5;
        assert_eq!(state.line_ending(), LineEnding::Mixed);
    }

    #[test]
    fn test_decode_stream_in_memory() {
        let data = b"alpha\r\nbeta\r\n";
        let cursor = std::io::Cursor::new(data);
        let (rope, enc, le) = decode_stream(cursor, None, |_| {}).unwrap();
        assert_eq!(rope.to_string(), "alpha\nbeta\n");
        assert_eq!(enc, "UTF-8");
        assert_eq!(le, LineEnding::CrLf);
    }

    #[test]
    fn test_decode_stream_empty() {
        let cursor = std::io::Cursor::new(b"");
        let (rope, enc, le) = decode_stream(cursor, None, |_| {}).unwrap();
        assert_eq!(rope.to_string(), "");
        assert_eq!(enc, "UTF-8");
        assert_eq!(le, LineEnding::Lf);
    }
}

