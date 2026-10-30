import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { wikiImageExtension } from './wikiImageExtension';
import { extractFrontmatter } from './frontmatter';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `data-line` lives on the outer <details> only; the inner <pre> must not carry it,
 * otherwise postProcessCodeBlocks would copy it onto its wrapper as a duplicate anchor.
 */
function renderFrontmatterBlock(raw: string, options: RenderMarkdownOptions): string {
  const label = escapeHtml(options.frontmatterLabel || 'Frontmatter');
  const open = options.frontmatterOpen ? ' open' : '';
  const code = raw ? `<pre><code class="language-yaml">${escapeHtml(raw)}</code></pre>` : '';
  const cls = raw ? 'frontmatter' : 'frontmatter frontmatter-empty';
  return `<details class="${cls}" data-line="1"${open}><summary>${label}</summary>${code}</details>\n`;
}

// Dedicated Marked instance configured with our custom extensions.
// NOTE: gfm/breaks live in the instance defaults on purpose. `instance.lexer(src, opts)` is
// a static Lexer.lex call that REPLACES the instance defaults with `opts`, which would silently
// drop registered extensions (e.g. WikiLink images). Always call lexer()/parser() without options.
const markedInstance = new Marked({ gfm: true, breaks: false });
markedInstance.use({
  extensions: [wikiImageExtension],
});

export interface RenderResult {
  html: string;
}

export interface RenderMarkdownOptions {
  /** Localized `<summary>` text of the frontmatter block. Defaults to "Frontmatter". */
  frontmatterLabel?: string;
  /** Whether the frontmatter `<details>` is rendered expanded. Defaults to collapsed. */
  frontmatterOpen?: boolean;
}

/**
 * Parses markdown to sanitized HTML with data-line attributes on block elements
 * for editor-to-preview scroll synchronization.
 *
 * A leading YAML frontmatter block is stripped from the markdown and rendered as a
 * `<details class="frontmatter">` card; `data-line` values of the remaining blocks stay
 * aligned with editor line numbers.
 */
export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): RenderResult {
  if (!markdown) {
    return { html: '' };
  }

  const fm = extractFrontmatter(markdown);
  const body = fm ? fm.body : markdown;

  let html = '';
  if (fm) {
    html += renderFrontmatterBlock(fm.raw, options);
  }

  // Tokenize using our configured Marked instance
  const tokens = body ? markedInstance.lexer(body) : [];
  // body line 1 sits on editor line `1 + lineCount` once the frontmatter prefix is stripped
  let currentLine = 1 + (fm ? fm.lineCount : 0);

  for (const token of tokens) {
    const startLine = currentLine;
    const rawNewlines = (token.raw.match(/\n/g) || []).length;
    currentLine += rawNewlines;

    // Skip whitespace tokens
    if (token.type === 'space') {
      continue;
    }

    // Parse the single block-level token using the configured instance parser
    let blockHtml = markedInstance.parser([token]);
    if (!blockHtml || !blockHtml.trim()) {
      continue;
    }

    blockHtml = blockHtml.trim();

    // Inject data-line attribute into root HTML tag
    if (/^<[a-zA-Z0-9]+(\s|>)/.test(blockHtml)) {
      blockHtml = blockHtml.replace(/^<([a-zA-Z0-9]+)/, `<$1 data-line="${startLine}"`);
    } else {
      blockHtml = `<div data-line="${startLine}">${blockHtml}</div>`;
    }

    html += blockHtml + '\n';
  }

  // Sanitize with DOMPurify
  const cleanHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ['input'],
    ADD_ATTR: [
      'data-line',
      'open',
      'target',
      'rel',
      'checked',
      'disabled',
      'type',
      'class',
      'id',
      'src',
      'alt',
      'title',
      'href',
      'width',
      'height',
    ],
  });

  return { html: cleanHtml };
}
