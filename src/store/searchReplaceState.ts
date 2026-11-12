import { atom } from 'jotai';
import { searchOpenAtom, searchTriggerAtom } from './atoms';
import { loadReplaceHistory } from './searchHistory';

/** Whether the replace row of the find panel is expanded. */
export const searchReplaceVisibleAtom = atom<boolean>(false);

/** Current text of the "Replace with" input. */
export const replaceTextAtom = atom<string>('');

/** Fills the replace input with the latest history entry when it is empty. */
const fillReplaceFromHistory = (
  get: (a: typeof replaceTextAtom) => string,
  set: (a: typeof replaceTextAtom, v: string) => void,
) => {
  if (get(replaceTextAtom) !== '') return;
  const history = loadReplaceHistory();
  if (history.length > 0) set(replaceTextAtom, history[0]);
};

/** Opens the find panel with the replace row collapsed (toolbar "Find"). */
export const openFindPanelAtom = atom(null, (_get, set) => {
  set(searchReplaceVisibleAtom, false);
  set(searchOpenAtom, true);
  set(searchTriggerAtom, (n) => n + 1);
});

/** Opens the find panel with the replace row expanded (toolbar "Replace"). */
export const openReplacePanelAtom = atom(null, (get, set) => {
  set(searchReplaceVisibleAtom, true);
  fillReplaceFromHistory(get, set);
  set(searchOpenAtom, true);
  set(searchTriggerAtom, (n) => n + 1);
});

/** Toggles the replace row from the panel's own "Replace" button. */
export const toggleReplaceVisibleAtom = atom(null, (get, set) => {
  const next = !get(searchReplaceVisibleAtom);
  set(searchReplaceVisibleAtom, next);
  if (next) fillReplaceFromHistory(get, set);
});
