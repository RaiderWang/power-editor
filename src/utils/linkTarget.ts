/**
 * Classification of a clicked link (preview `<a>` or editor Ctrl+click) into what the app
 * should do with it. Pure functions, no DOM / Tauri access.
 */
export type LinkTarget =
  /** `http(s):` / `mailto:` -> OS default handler. */
  | { kind: 'external'; url: string }
  /** Same-document heading (`#heading`, `[[#heading]]`). */
  | { kind: 'anchor'; heading: string }
  /** A local note/file to open in Power Editor (`[[entities/Foo]]`, `[x](../a.md)`). */
  | { kind: 'note'; target: string; heading: string };

/** `decodeURIComponent` that never throws (malformed escapes are returned as-is). */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Builds a link target from the pieces of a parsed wikilink. */
export function wikiLinkTarget(target: string, heading: string): LinkTarget | null {
  const t = target.trim();
  const h = heading.trim();
  if (!t) return h ? { kind: 'anchor', heading: h } : null;
  return { kind: 'note', target: t, heading: h };
}

const EXTERNAL_RE = /^(https?:|mailto:)/i;
// Any other `scheme:` (file:, javascript:, tel:, ...). A single letter is a Windows drive (`C:\`).
const OTHER_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/**
 * Classifies a markdown `href` (already HTML-decoded by the DOM / taken from source text).
 * Returns `null` for links the app must ignore (unknown protocols, empty).
 */
export function classifyHref(rawHref: string): LinkTarget | null {
  const href = rawHref.trim();
  if (!href) return null;

  if (href.startsWith('#')) {
    const heading = safeDecode(href.slice(1)).trim();
    return heading ? { kind: 'anchor', heading } : null;
  }
  if (EXTERNAL_RE.test(href)) return { kind: 'external', url: href };
  if (OTHER_SCHEME_RE.test(href)) return null;

  // Local path, optionally with `#heading`; marked percent-encodes non-ASCII characters.
  const hash = href.indexOf('#');
  const pathPart = hash >= 0 ? href.slice(0, hash) : href;
  const heading = hash >= 0 ? safeDecode(href.slice(hash + 1)).trim() : '';
  const target = safeDecode(pathPart).trim();
  return wikiLinkTarget(target, heading);
}
