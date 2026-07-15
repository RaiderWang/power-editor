import type { TFunction } from '../i18n';
import type { TabState } from '../types';

const DEFAULT_SAVE_NAME = 'untitled.txt';

/** Invalid filename characters on Windows (also rejected on other platforms). */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

export function getUntitledName(t: TFunction): string {
  return t('untitled');
}

export function getTabFileName(tab: TabState, t: TFunction): string {
  if (tab.fileInfo.path) {
    return tab.fileInfo.path.split(/[/\\]/).pop() ?? tab.fileInfo.path;
  }
  return tab.untitledName ?? t('untitled');
}

export function getTabSaveDefaultPath(tab: TabState): string {
  if (tab.fileInfo.path) return tab.fileInfo.path;
  return tab.untitledName ?? DEFAULT_SAVE_NAME;
}

export function getTabTitle(tab: TabState, t: TFunction): string {
  if (tab.fileInfo.path) return tab.fileInfo.path;
  return tab.untitledName ?? t('untitled');
}

export function validateFileName(name: string, t: TFunction): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t('validate.nameEmpty');
  if (trimmed === '.' || trimmed === '..') return t('validate.nameInvalid');
  if (INVALID_NAME_CHARS.test(trimmed)) return t('validate.nameChars');
  return null;
}
