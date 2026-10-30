import { atom } from 'jotai';
import { tabsAtom, activeTabIdAtom } from './atoms';
import { previewTabIdsAtom } from './previewTabs';

export type SplitLayout = 'none' | 'horizontal' | 'vertical';
export type PaneId = 'primary' | 'secondary';
export type SecondaryMode = 'editor' | 'markdownPreview';

export const splitLayoutAtom = atom<SplitLayout>('none');
export const secondaryModeAtom = atom<SecondaryMode>('editor');

export const secondaryActiveTabIdAtom = atom<string | null>(null);

export const secondaryActiveTabAtom = atom((get) => {
  const tabs = get(tabsAtom);
  const id = get(secondaryActiveTabIdAtom);
  return tabs.find((t) => t.id === id) ?? null;
});

/** Which pane currently has keyboard/mouse focus. */
export const activePaneAtom = atom<PaneId>('primary');

/** Action to open split pane and set secondary mode ('editor' or 'markdownPreview') */
export const openSplitAtom = atom(
  null,
  (get, set, layout: 'horizontal' | 'vertical' = 'horizontal', mode: SecondaryMode = 'editor') => {
    const currentPrimary = get(activeTabIdAtom);
    set(secondaryActiveTabIdAtom, currentPrimary);
    set(splitLayoutAtom, layout);
    set(secondaryModeAtom, mode);
  }
);

/** Reset split state without touching per-tab preview memory (used for automatic hiding). */
export const resetSplitAtom = atom(
  null,
  (_get, set) => {
    set(splitLayoutAtom, 'none');
    set(secondaryActiveTabIdAtom, null);
    set(secondaryModeAtom, 'editor');
    set(activePaneAtom, 'primary');
  }
);

/** Action to close split pane (manual). Closing a preview forgets it for the active tab. */
export const closeSplitAtom = atom(
  null,
  (get, set) => {
    if (get(splitLayoutAtom) !== 'none' && get(secondaryModeAtom) === 'markdownPreview') {
      const activeId = get(activeTabIdAtom);
      if (activeId) {
        set(previewTabIdsAtom, (prev) => prev.filter((id) => id !== activeId));
      }
    }
    set(resetSplitAtom);
  }
);

