import { atom } from 'jotai';
import { tabsAtom } from './atoms';

export type SplitLayout = 'none' | 'horizontal' | 'vertical';
export type PaneId = 'primary' | 'secondary';

export const splitLayoutAtom = atom<SplitLayout>('none');

export const secondaryActiveTabIdAtom = atom<string | null>(null);

export const secondaryActiveTabAtom = atom((get) => {
  const tabs = get(tabsAtom);
  const id = get(secondaryActiveTabIdAtom);
  return tabs.find((t) => t.id === id) ?? null;
});

/** Which pane currently has keyboard/mouse focus. */
export const activePaneAtom = atom<PaneId>('primary');
