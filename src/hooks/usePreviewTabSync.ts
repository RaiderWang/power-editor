import { useEffect } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { activeTabAtom } from '../store/atoms';
import { previewTabIdsAtom } from '../store/previewTabs';
import { isPreviewOpenAtom } from '../store/previewAtoms';
import { splitLayoutAtom, secondaryModeAtom, resetSplitAtom } from '../store/splitAtoms';
import { isMarkdownLanguage } from '../extensions/builtinLanguages';

/**
 * Keeps the Markdown preview pane in sync with the active tab: the preview is
 * remembered per tab, shown only for Markdown tabs where it was opened, and
 * hidden automatically (without forgetting) when switching to any other tab.
 */
export function usePreviewTabSync() {
  const store = useStore();
  const activeTab = useAtomValue(activeTabAtom);
  const tabId = activeTab?.id ?? null;
  const language = activeTab?.language ?? null;

  useEffect(() => {
    const wants =
      !!tabId &&
      isMarkdownLanguage(language) &&
      store.get(previewTabIdsAtom).includes(tabId);
    const isOpen = store.get(isPreviewOpenAtom);

    if (wants && !isOpen) {
      // Do not override a user-opened editor split.
      if (store.get(splitLayoutAtom) === 'none') {
        store.set(splitLayoutAtom, 'horizontal');
        store.set(secondaryModeAtom, 'markdownPreview');
      }
    } else if (!wants && isOpen) {
      store.set(resetSplitAtom);
    }
  }, [store, tabId, language]);
}
