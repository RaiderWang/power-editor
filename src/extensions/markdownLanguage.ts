import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import type { Extension } from '@codemirror/state';
import { codeLanguages } from '../utils/codeLanguages';

/**
 * Builds the CodeMirror 6 markdown extension with GFM base syntax,
 * dynamic code block syntax highlighting for fenced languages,
 * and YAML frontmatter (`---` ... `---` at the document start) highlighting.
 *
 * Frontmatter only exists at the very top of a file; when the virtual window has
 * slid down (start > 0) the CM doc no longer begins with `---`, so nothing is misdetected.
 */
export function markdownExtension(): Extension {
  return yamlFrontmatter({
    content: markdown({
      base: markdownLanguage,
      codeLanguages,
    }),
  });
}
