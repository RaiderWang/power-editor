import type { createStore } from 'jotai';
import { externalChangeTabIdAtom, externalDeletedTabIdsAtom } from '../store/atoms';

type JotaiStore = ReturnType<typeof createStore>;

/**
 * Withdraw any "changed / deleted on disk" prompt for `tabId`.
 * Call after the tab's file was written back (save / save as) or the tab was
 * closed, since the watcher suppresses self-saves and would never clear them.
 */
export function clearExternalPrompts(store: JotaiStore, tabId: string): void {
  const deleted = store.get(externalDeletedTabIdsAtom);
  if (deleted.includes(tabId)) {
    store.set(externalDeletedTabIdsAtom, deleted.filter((id) => id !== tabId));
  }
  if (store.get(externalChangeTabIdAtom) === tabId) {
    store.set(externalChangeTabIdAtom, null);
  }
}
