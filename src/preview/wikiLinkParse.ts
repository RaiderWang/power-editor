/**
 * Parsed form of the text inside an Obsidian-style wikilink `[[...]]`.
 *
 * Standard syntax is `[[target#heading|alias]]`:
 * - everything right of the FIRST `|` is the display alias,
 * - the left part is split at the FIRST `#` into `target` and `heading`,
 * - `target` may be empty (`[[#heading]]` = same-document anchor).
 */
export interface WikiLinkInfo {
  /** Note path/name without `#heading` (may be empty for same-document anchors). */
  target: string;
  /** Heading text after `#`, or an empty string. */
  heading: string;
  /** Display alias after `|`, or an empty string. */
  alias: string;
}

/**
 * Parses the inner text of `[[...]]`. Returns `null` when there is neither a target
 * nor a heading (e.g. `[[ ]]`, `[[#]]`, `[[|x]]`).
 */
export function parseWikiLink(rawText: string): WikiLinkInfo | null {
  // `\|` is the GFM-table escape for a pipe inside a cell.
  const normalized = rawText.replace(/\\\|/g, '|');

  const pipe = normalized.indexOf('|');
  const left = pipe >= 0 ? normalized.slice(0, pipe) : normalized;
  const alias = pipe >= 0 ? normalized.slice(pipe + 1).trim() : '';

  const hash = left.indexOf('#');
  const target = (hash >= 0 ? left.slice(0, hash) : left).trim();
  const heading = hash >= 0 ? left.slice(hash + 1).trim() : '';

  if (!target && !heading) return null;
  return { target, heading, alias };
}

/** Text shown for a wikilink: alias, else `target` / `target > heading` / `heading`. */
export function wikiLinkDisplayText(info: WikiLinkInfo): string {
  if (info.alias) return info.alias;
  if (info.target && info.heading) return `${info.target} > ${info.heading}`;
  return info.target || info.heading;
}
