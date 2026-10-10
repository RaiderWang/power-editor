import { LanguageDescription } from '@codemirror/language';

/**
 * Shared code language descriptions for syntax highlighting fenced code blocks
 * in both CodeMirror editor and Markdown preview pane.
 * Loads language packages dynamically on demand.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py', 'pyw'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'json',
    alias: ['jsonc'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm', 'xhtml'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'css',
    alias: ['scss', 'less'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'sql',
    alias: ['mysql', 'pgsql', 'postgres', 'sqlite'],
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'xml',
    alias: ['svg', 'plist'],
    load: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  }),
  LanguageDescription.of({
    name: 'java',
    alias: ['jav'],
    load: () => import('@codemirror/lang-java').then((m) => m.java()),
  }),
  LanguageDescription.of({
    name: 'cpp',
    alias: ['c', 'c++', 'cc', 'cxx', 'h', 'hpp', 'hxx'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
];

/**
 * Find a LanguageDescription by language name or alias (case-insensitive).
 */
export function findLanguageDescription(langName: string): LanguageDescription | null {
  const target = langName.trim().toLowerCase();
  if (!target) return null;
  return LanguageDescription.matchLanguageName(codeLanguages, target, true);
}
