import type { Extension } from '@codemirror/state';
import { markdownExtension } from './markdownLanguage';

export interface BuiltinLanguage {
  id: string;
  name: string;
  extensions: string[];
  build: () => Extension;
}

export const BUILTIN_LANGUAGES: BuiltinLanguage[] = [
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'],
    build: markdownExtension,
  },
];

export function findBuiltinByExt(ext: string | null | undefined): BuiltinLanguage | null {
  if (!ext) return null;
  const lower = ext.trim().toLowerCase();
  return BUILTIN_LANGUAGES.find((lang) => lang.extensions.includes(lower)) ?? null;
}

export function findBuiltinByName(name: string | null | undefined): BuiltinLanguage | null {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  return BUILTIN_LANGUAGES.find((lang) => lang.name.toLowerCase() === target) ?? null;
}

export function isMarkdownLanguage(ext: string | null | undefined): boolean {
  return findBuiltinByExt(ext)?.id === 'markdown';
}
