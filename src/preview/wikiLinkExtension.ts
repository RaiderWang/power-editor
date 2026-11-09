import type { TokenizerAndRendererExtension, Tokens } from 'marked';
import { IMAGE_EXTENSIONS } from './wikiImageExtension';
import { parseWikiLink, wikiLinkDisplayText } from './wikiLinkParse';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface WikiLinkToken extends Tokens.Generic {
  type: 'wikiLink';
  raw: string;
  target: string;
  heading: string;
  text: string;
}

/**
 * Marked extension that renders `[[target#heading|alias]]` as a clickable
 * `<a class="wikilink" data-wikilink=... data-heading=...>`.
 *
 * It also accepts a leading `!`: when `wikiImageExtension` declines `![[note]]`
 * (not an image), marked's built-in text rule would otherwise swallow the `!` and the
 * tokenizer would never see it. Such embeds are rendered as a plain link (no `!`).
 */
export const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start(src: string): number | void {
    return src.match(/!?\[\[/)?.index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = /^(!?)\[\[([^\]\r\n]+)\]\]/.exec(src);
    if (!match) return;

    const parsed = parseWikiLink(match[2]);
    if (!parsed) return;

    // `![[image.png]]` belongs to wikiImageExtension.
    if (match[1] && IMAGE_EXTENSIONS.test(parsed.target)) return;

    const token: WikiLinkToken = {
      type: 'wikiLink',
      raw: match[0],
      target: parsed.target,
      heading: parsed.heading,
      text: wikiLinkDisplayText(parsed),
    };
    return token;
  },
  renderer(token: Tokens.Generic): string {
    const t = token as WikiLinkToken;
    return (
      `<a class="wikilink" href="#" data-wikilink="${escapeHtml(t.target)}"` +
      ` data-heading="${escapeHtml(t.heading)}">${escapeHtml(t.text)}</a>`
    );
  },
};
