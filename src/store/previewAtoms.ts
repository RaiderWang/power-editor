import { atom } from 'jotai';
import { activeTabAtom } from './atoms';
import { isMarkdownLanguage } from '../extensions/builtinLanguages';
import {
  splitLayoutAtom,
  secondaryModeAtom,
  closeSplitAtom,
} from './splitAtoms';

export const MARKDOWN_PREVIEW_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface PreviewEligibility {
  canPreview: boolean;
  reason?: 'not_markdown' | 'loading' | 'too_large';
}

export const previewEligibilityAtom = atom<PreviewEligibility>((get) => {
  const tab = get(activeTabAtom);
  if (!tab || !isMarkdownLanguage(tab.language)) {
    return { canPreview: false, reason: 'not_markdown' };
  }
  if (!tab.fileInfo.is_fully_loaded) {
    return { canPreview: false, reason: 'loading' };
  }
  if (tab.fileInfo.total_bytes > MARKDOWN_PREVIEW_MAX_BYTES) {
    return { canPreview: false, reason: 'too_large' };
  }
  return { canPreview: true };
});

export const canPreviewAtom = atom((get) => get(previewEligibilityAtom).canPreview);

export const isPreviewOpenAtom = atom((get) => {
  const layout = get(splitLayoutAtom);
  const mode = get(secondaryModeAtom);
  return layout !== 'none' && mode === 'markdownPreview';
});

export const toggleMarkdownPreviewAtom = atom(null, (get, set) => {
  const isOpen = get(isPreviewOpenAtom);
  if (isOpen) {
    set(closeSplitAtom);
    return;
  }

  const eligibility = get(previewEligibilityAtom);
  if (!eligibility.canPreview) return;

  if (get(splitLayoutAtom) === 'none') {
    set(splitLayoutAtom, 'horizontal');
  }
  set(secondaryModeAtom, 'markdownPreview');
});

/** Editor -> Preview scroll synchronization toggle */
export const syncScrollAtom = atom<boolean>(true);
