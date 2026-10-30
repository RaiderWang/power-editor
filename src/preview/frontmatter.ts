/**
 * YAML frontmatter extraction for Markdown preview / print.
 *
 * Only the first FRONTMATTER_SCAN_LIMIT characters are scanned, so cost stays bounded
 * regardless of document size. An unterminated block inside that window is NOT frontmatter.
 */

const FRONTMATTER_SCAN_LIMIT = 64 * 1024;

// Opening `---`, then EITHER an immediately-closing fence (empty frontmatter, tried first so the
// lazy body group can never swallow a later `---` in the document), OR body + closing fence.
// The closing fence consumes its trailing newline so that `md === match[0] + body`.
const FM_REGEX =
  /^\uFEFF?---[ \t]*\r?\n(?:(?:---|\.\.\.)[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/;

// After skipping blank lines and `#` comments, the first line of a non-empty block must be a
// top-level `key:` mapping entry (list items like `- a` are rejected). Otherwise a leading
// horizontal rule + `# Heading` / `- item` + a later `---` would be mistaken for frontmatter.
const YAML_KEY_LINE = /^(?!-\s)(?:[^\s:#][^:]*|["'][^"']*["']):(?:\s|$)/;

export interface FrontmatterResult {
  /** Raw YAML text between the fences (no fences, no trailing newline). */
  raw: string;
  /** Number of `\n` in the stripped prefix; body line 1 maps to editor line `1 + lineCount`. */
  lineCount: number;
  /** Remaining markdown. Always sliced from the original string. */
  body: string;
}

export function extractFrontmatter(md: string): FrontmatterResult | null {
  if (!md) return null;
  const startsWithFence = md.startsWith('---') || md.startsWith('\uFEFF---');
  if (!startsWithFence) return null;

  const head = md.length > FRONTMATTER_SCAN_LIMIT ? md.slice(0, FRONTMATTER_SCAN_LIMIT) : md;
  const match = FM_REGEX.exec(head);
  if (!match) return null;
  // A match that ends exactly at the truncation point may have been closed by `$` on cut-off text.
  if (head.length < md.length && match[0].length === head.length) return null;

  let raw = match[1] ?? '';
  if (!raw.trim()) {
    // `---\n---` and `---\n   \n---` are both treated as an empty frontmatter block
    raw = '';
  } else {
    const firstContentLine = raw
      .split(/\r?\n/)
      .find((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
    // Comment-only blocks (e.g. `---\n# Heading\n---`) are not frontmatter either
    if (firstContentLine === undefined || !YAML_KEY_LINE.test(firstContentLine)) {
      return null;
    }
  }

  const prefixLength = match[0].length;
  return {
    raw,
    lineCount: (match[0].match(/\n/g) || []).length,
    // Slice from the ORIGINAL string, not `head`, so documents > 64 KB keep their full body.
    body: md.slice(prefixLength),
  };
}
