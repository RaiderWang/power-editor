import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { wikiImageExtension } from './wikiImageExtension';

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

/**
 * Parses markdown to sanitized HTML with data-line attributes on block elements
 * for editor-to-preview scroll synchronization.
 */
export function renderMarkdown(markdown: string): RenderResult {
  if (!markdown) {
    return { html: '' };
  }

  // Tokenize using our configured Marked instance
  const tokens = markedInstance.lexer(markdown);
  let html = '';
  let currentLine = 1;

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
