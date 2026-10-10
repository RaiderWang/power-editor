import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { codeLanguages } from '../utils/codeLanguages';

/**
 * Builds the CodeMirror 6 markdown extension with GFM base syntax
 * and dynamic code block syntax highlighting for fenced languages.
 */
export function markdownExtension(): Extension {
  return markdown({
    base: markdownLanguage,
    codeLanguages,
  });
}
