import { marked } from 'marked';
import DOMPurify from 'dompurify';

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

  // Tokenize using marked lexer
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
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

    // Parse the single block-level token
    let blockHtml = marked.parser([token]);
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
    ],
  });

  return { html: cleanHtml };
}
