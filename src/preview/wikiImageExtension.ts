import type { TokenizerAndRendererExtension, Tokens } from 'marked';

/**
 * Common image file extensions supported for WikiLink embedding.
 */
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|tiff?)$/i;

export interface WikiImageInfo {
  target: string;
  alt: string;
  width?: string;
  height?: string;
}

/**
 * Escapes quotes and special HTML characters in attribute values.
 */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parses the content inside `![[...]]` into target path, alt text, and dimensions.
 *
 * Supported formats:
 * - `![[path/to/image.png]]`
 * - `![[image.png|300]]` (width 300)
 * - `![[image.png|300x200]]` (width 300, height 200)
 * - `![[image.png|Alt description]]`
 * - `![[image.png|Alt description|300]]`
 * - `![[image.png|300|Alt description]]`
 */
export function parseWikiImage(rawText: string): WikiImageInfo | null {
  const parts = rawText.split('|').map((s) => s.trim());
  const target = parts[0];
  if (!target) return null;

  // Derive default alt text from filename without path
  const filename = target.split(/[/\\]/).pop() || target;
  let alt = filename;
  let width: string | undefined;
  let height: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    const dimMatch = /^(\d+)(?:x(\d+))?$/.exec(part);
    if (dimMatch) {
      width = dimMatch[1];
      if (dimMatch[2]) {
        height = dimMatch[2];
      }
    } else {
      alt = part;
    }
  }

  return { target, alt, width, height };
}

export interface WikiImageToken extends Tokens.Generic {
  type: 'wikiImage';
  raw: string;
  target: string;
  alt: string;
  width?: string;
  height?: string;
}

/**
 * Marked extension providing WikiLink image embed compatibility (`![[...]`).
 */
export const wikiImageExtension: TokenizerAndRendererExtension = {
  name: 'wikiImage',
  level: 'inline',
  start(src: string): number | void {
    const match = src.match(/!\[\[/);
    return match?.index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = /^!\[\[([^\]\r\n]+)\]\]/.exec(src);
    if (!match) return;

    const parsed = parseWikiImage(match[1]);
    if (!parsed) return;

    // Guard: Only handle known image extensions (leave non-images like note embeds untouched)
    if (!IMAGE_EXTENSIONS.test(parsed.target)) {
      return;
    }

    const token: WikiImageToken = {
      type: 'wikiImage',
      raw: match[0],
      target: parsed.target,
      alt: parsed.alt,
      width: parsed.width,
      height: parsed.height,
    };
    return token;
  },
  renderer(token: Tokens.Generic): string {
    const t = token as WikiImageToken;
    let attrs = `src="${escapeAttr(t.target)}" alt="${escapeAttr(t.alt)}"`;
    if (t.width) {
      attrs += ` width="${escapeAttr(t.width)}"`;
    }
    if (t.height) {
      attrs += ` height="${escapeAttr(t.height)}"`;
    }
    return `<img ${attrs} />`;
  },
};
