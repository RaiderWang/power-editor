import { atom } from 'jotai';
import type { Getter, Setter } from 'jotai';
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

/** If a Markdown preview is currently open, forget it for the active tab. */
function forgetOpenPreviewForActiveTab(get: Getter, set: Setter) {
  if (get(splitLayoutAtom) === 'none' || get(secondaryModeAtom) !== 'markdownPreview') return;
  const activeId = get(activeTabIdAtom);
  if (activeId) {
    set(previewTabIdsAtom, (prev) => prev.filter((id) => id !== activeId));
  }
}

/** Action to open split pane and set secondary mode ('editor' or 'markdownPreview') */
export const openSplitAtom = atom(
  null,
  (get, set, layout: 'horizontal' | 'vertical' = 'horizontal', mode: SecondaryMode = 'editor') => {
    // Replacing an open preview with an editor split drops the preview for this tab.
    if (mode === 'editor') forgetOpenPreviewForActiveTab(get, set);
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
    forgetOpenPreviewForActiveTab(get, set);
    set(resetSplitAtom);
  }
);

