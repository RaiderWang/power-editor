import { useAtomValue } from 'jotai';
import { editorPrefsAtom } from '../store/atoms';
import type { Locale } from '../store/editorPrefs';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

type Messages = Record<string, string>;

const localeMap: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

function createT(locale: Locale): TFunction {
  const messages = localeMap[locale];
  return (key, params) => {
    let text = messages[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}

export function useTranslation(): TFunction {
  const prefs = useAtomValue(editorPrefsAtom);
  return createT(prefs.locale);
}

/**
 * Non-reactive translation for use outside React components
 * (e.g. in keybindings.ts defaults). Reads locale from localStorage directly.
 */
export function getTranslation(locale: Locale): TFunction {
  return createT(locale);
}
