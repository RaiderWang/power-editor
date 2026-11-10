const encoder = new TextEncoder();

/**
 * UTF-8 byte length of a string.
 *
 * Only used by `syncEditorToRust` for the optimistic window end after a sync. Window
 * ranges coming from Rust (`LineChunk.start_byte_offset` / `end_byte_offset`) are
 * already exact and must be used as-is.
 */
export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}
