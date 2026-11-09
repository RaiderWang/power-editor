import { parseWikiLink } from '../preview/wikiLinkParse';
import { classifyHref, wikiLinkTarget } from '../utils/linkTarget';
import type { LinkTarget } from '../utils/linkTarget';

/** A link found in a line of Markdown source. `from`/`to` are offsets within the scanned text. */
export interface FoundLink {
  from: number;
  to: number;
  link: LinkTarget;
}

/** Longest stretch of a (possibly minified) line scanned around the click: O(1) per click. */
const SCAN_RADIUS = 2000;

// Image syntax (`![[...]]`, `![](...)`) is deliberately excluded: Ctrl+click must not try to
// open images as text documents.
const WIKILINK_RE = /(!?)\[\[([^\]\r\n]+)\]\]/g;
const MD_LINK_RE = /(!?)\[[^\]\r\n]*\]\(\s*(<[^>\r\n]*>|[^)\s]+)(?:\s+"[^"\r\n]*")?\s*\)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

function* matchesOf(re: RegExp, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

/**
 * Finds the link (markdown `[text](url)`, `[[wikilink]]` or bare URL) that contains `offset`
 * in `lineText`. Only a window of the line around `offset` is scanned. Returned `from`/`to`
 * are relative to `lineText`.
 */
export function findLinkAt(lineText: string, offset: number): FoundLink | null {
  const winStart = Math.max(0, offset - SCAN_RADIUS);
  const text = lineText.slice(winStart, offset + SCAN_RADIUS);
  const rel = offset - winStart;
  const contains = (from: number, to: number) => rel >= from && rel < to;

  for (const m of matchesOf(MD_LINK_RE, text)) {
    if (m[1] || !contains(m.index, m.index + m[0].length)) continue;
    let href = m[2];
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    const link = classifyHref(href);
    if (link) return { from: winStart + m.index, to: winStart + m.index + m[0].length, link };
  }

  for (const m of matchesOf(WIKILINK_RE, text)) {
    if (m[1] || !contains(m.index, m.index + m[0].length)) continue;
    const parsed = parseWikiLink(m[2]);
    const link = parsed && wikiLinkTarget(parsed.target, parsed.heading);
    if (link) return { from: winStart + m.index, to: winStart + m.index + m[0].length, link };
  }

  for (const m of matchesOf(BARE_URL_RE, text)) {
    const url = m[0].replace(TRAILING_PUNCT_RE, '');
    if (!contains(m.index, m.index + url.length)) continue;
    return {
      from: winStart + m.index,
      to: winStart + m.index + url.length,
      link: { kind: 'external', url },
    };
  }

  return null;
}

/** Heading text of an ATX heading line (`## Title ##` -> `Title`), or `null`. */
export function atxHeadingText(line: string): string | null {
  const m = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
  return m ? m[1].trim() : null;
}
