import type { LanguageDef } from '../types';
import { BUILTIN_LANGUAGES, findBuiltinByExt, findBuiltinByName } from '../extensions/builtinLanguages';

/**
 * Resolves the display name for a given language file extension.
 * Checks built-in languages first, then wordfile definitions.
 */
export function resolveLangName(ext: string | null | undefined, langDefs: LanguageDef[]): string {
  if (!ext) return '';
  const builtin = findBuiltinByExt(ext);
  if (builtin) return builtin.name;

  const lower = ext.trim().toLowerCase();
  const def = langDefs.find((d) => d.extensions.map((e) => e.toLowerCase()).includes(lower));
  return def ? def.name : '';
}

/**
 * Resolves the extension to set when a user selects a language by display name.
 * Returns null if plain text (empty name) is chosen.
 */
export function resolveLangExtension(name: string, langDefs: LanguageDef[]): string | null {
  if (!name) return null;
  const builtin = findBuiltinByName(name);
  if (builtin && builtin.extensions.length > 0) {
    return builtin.extensions[0];
  }

  const def = langDefs.find((d) => d.name === name);
  if (def && def.extensions.length > 0) {
    return def.extensions[0];
  }

  return null;
}

/**
 * Returns all selectable languages (built-ins followed by wordfile definitions),
 * ensuring built-in languages are not duplicated.
 */
export function getSelectableLanguages(langDefs: LanguageDef[]): Array<{ name: string; isBuiltin: boolean }> {
  const result: Array<{ name: string; isBuiltin: boolean }> = [];
  const addedNames = new Set<string>();

  for (const b of BUILTIN_LANGUAGES) {
    result.push({ name: b.name, isBuiltin: true });
    addedNames.add(b.name.toLowerCase());
  }

  for (const def of langDefs) {
    if (!addedNames.has(def.name.toLowerCase())) {
      result.push({ name: def.name, isBuiltin: false });
      addedNames.add(def.name.toLowerCase());
    }
  }

  return result;
}
