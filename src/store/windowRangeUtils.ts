import type { LineChunk } from '../types';

const encoder = new TextEncoder();

/**
 * Replace All stays undoable (through CodeMirror history) only while the whole
 * document fits in CM and is below this size (chars / bytes).  CM6 undo keeps the
 * full old document for a whole-doc replacement, so huge docs would double memory.
 */
export const REPLACE_ALL_UNDO_THRESHOLD = 10_000_000;

/** UTF-8 byte length of a string. */
export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Text that a `LineChunk` contributes to the CodeMirror document
 * (lines joined with `\n`, no trailing newline).
 */
export function chunkText(chunk: LineChunk): string {
  return chunk.lines.join('\n');
}

/**
 * Byte range `[start, end)` of the Rust rope that corresponds EXACTLY to
 * `chunkText(chunk)` once it is inserted into CodeMirror.
 *
 * Rust's `LineChunk.end_byte_offset` points at the start of the next line, so
 * it includes the `\n` that terminates the window's last line, which is NOT part
 * of the CM text. Using it as the window end would make `syncEditorToRust`
 * swallow that newline and merge the last window line with the next one.
 */
export function chunkByteRange(chunk: LineChunk): { start: number; end: number } {
  return {
    start: chunk.start_byte_offset,
    end: chunk.start_byte_offset + utf8ByteLength(chunkText(chunk)),
  };
}
