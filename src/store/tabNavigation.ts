import { atom } from 'jotai';
import type { Getter, Setter } from 'jotai';
import { tabsAtom, activeTabIdAtom } from './atoms';
import {
  splitLayoutAtom,
  secondaryModeAtom,
  secondaryActiveTabIdAtom,
  activePaneAtom,
  type PaneId,
} from './splitAtoms';
import { focusEditor } from './editorViewRegistry';

/**
 * Bumped on every keyboard-driven tab switch. Transient UI that should dismiss when the
 * user navigates by keyboard (e.g. the tab list dropdown) subscribes to this instead of
 * watching `activeTabId`, which also changes for legitimate in-UI actions (closing the
 * current tab from inside the dropdown).
 */
export const tabNavigationTickAtom = atom(0);

/**
 * Which pane keyboard tab navigation should act on.
 *
 * Only an editor split with focus on the secondary pane targets `secondary`.
 * In Markdown-preview split (no secondary tab bar) or with a stale `activePaneAtom`,
 * always fall back to `primary` so shortcuts never mutate an invisible pane.
 */
function resolveTargetPane(get: Getter): PaneId {
  const splitActive = get(splitLayoutAtom) !== 'none' && get(secondaryModeAtom) === 'editor';
  return splitActive && get(activePaneAtom) === 'secondary' ? 'secondary' : 'primary';
}

/** Activate the tab at `index` in the target pane and focus its editor. */
function activateTabAt(get: Getter, set: Setter, pane: PaneId, index: number): void {
  const tab = get(tabsAtom)[index];
  if (!tab) return;
  set(pane === 'primary' ? activeTabIdAtom : secondaryActiveTabIdAtom, tab.id);
  set(tabNavigationTickAtom, (n) => n + 1);
  focusEditor(tab.bufferId, pane);
}

/** Switch to the previous (-1) / next (+1) tab in the focused pane, wrapping around. */
export const switchTabRelativeAtom = atom(null, (get, set, delta: 1 | -1) => {
  const tabs = get(tabsAtom);
  if (tabs.length < 2) return;
  const pane = resolveTargetPane(get);
  const currentId = get(pane === 'primary' ? activeTabIdAtom : secondaryActiveTabIdAtom);
  const currentIdx = tabs.findIndex((t) => t.id === currentId);
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + delta + tabs.length) % tabs.length;
  activateTabAt(get, set, pane, nextIdx);
});

/** Switch to the Nth tab (1-based) in the focused pane. Out-of-range is a no-op. */
export const switchTabByIndexAtom = atom(null, (get, set, oneBasedIndex: number) => {
  activateTabAt(get, set, resolveTargetPane(get), oneBasedIndex - 1);
});
