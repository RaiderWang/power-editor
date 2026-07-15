import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { editorPrefsAtom } from '../store/atoms';
import { saveEditorPrefs } from '../store/editorPrefs';

/** Saves editor preferences to localStorage whenever they change. */
export function usePrefsPersist(): void {
  const prefs = useAtomValue(editorPrefsAtom);
  useEffect(() => {
    saveEditorPrefs(prefs);
  }, [prefs]);
}
