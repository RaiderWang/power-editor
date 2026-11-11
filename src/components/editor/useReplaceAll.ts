import { useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  activeTabAtom,
  currentMatchIndexAtom,
  searchMatchesAtom,
  searchTotalAtom,
  tabsAtom,
} from '../../store/atoms';
import { activePaneAtom, secondaryActiveTabAtom } from '../../store/splitAtoms';
import { rememberFocus, replaceProgressAtom } from '../../store/replaceProgress';
import { showToastAtom } from '../../store/toastAtoms';
import { noteReplaceAllDone } from '../../store/replaceUndo';
import {
  clearSearchHighlights,
  focusEditor,
  markSearchStale,
  reloadCurrentWindow,
  syncEditorToRust,
} from '../../store/editorViewRegistry';
import * as cmd from '../../store/tauriCommands';
import { expandSpecialChars } from '../../utils/specialChars';
import { useTranslation } from '../../i18n';
import type { ReplaceAllOutcome, SearchParams } from '../../types';

interface UseReplaceAllOptions {
  params: SearchParams;
  replaceText: string;
  /** Refreshes the match list; started in the background after the replace. */
  doSearch: (options?: { noScroll?: boolean }) => Promise<void>;
  /** Publishes "no matches" without a search; used when the replace itself found none. */
  applyEmptyResult: () => void;
  /** Called after a completed (not cancelled) replace, e.g. to record history. */
  onReplaced: () => void;
}

/**
 * Replace All for the active tab: runs the Rust background job while the progress
 * overlay (`replaceProgressAtom`) blocks the UI, then refreshes the editor window.
 *
 * The overlay goes away as soon as the text and window are updated; the follow-up
 * search (a full scan on huge files) runs afterwards without blocking anything.
 */
export function useReplaceAll({
  params,
  replaceText,
  doSearch,
  applyEmptyResult,
  onReplaced,
}: UseReplaceAllOptions) {
  const t = useTranslation();
  const activeTab = useAtomValue(activeTabAtom);
  const activePane = useAtomValue(activePaneAtom);
  const secondaryActiveTab = useAtomValue(secondaryActiveTabAtom);
  const setTabs = useSetAtom(tabsAtom);
  const setMatches = useSetAtom(searchMatchesAtom);
  const setTotal = useSetAtom(searchTotalAtom);
  const setCurrentIdx = useSetAtom(currentMatchIndexAtom);
  const [progress, setProgress] = useAtom(replaceProgressAtom);
  const showToast = useSetAtom(showToastAtom);
  // Synchronous re-entrancy guard (a second Enter can arrive before the atom re-renders).
  const runningRef = useRef(false);

  return async function doReplaceAll(): Promise<void> {
    if (!activeTab || !params.pattern) return;
    if (activeTab.readOnly || activeTab.fileInfo.is_read_only || !activeTab.fileInfo.is_fully_loaded) return;
    if (runningRef.current || progress !== null) return;

    const bufferId = activeTab.bufferId;
    runningRef.current = true;
    // Must happen before the overlay renders (it disables the Replace button, which
    // can drop focus); the overlay hands focus back if the run is cancelled / fails.
    rememberFocus();
    setProgress({
      bufferId,
      bytesDone: 0,
      totalBytes: activeTab.fileInfo.total_bytes,
      matches: 0,
      cancelling: false,
    });

    let outcome: ReplaceAllOutcome | null;
    try {
      // Sync any pending CM edits (including Ctrl+Z undo) to Rust before replacing,
      // so the replace operates on the current editor content, not a stale rope.
      await syncEditorToRust(bufferId);

      const replaceParams = params.is_regex
        ? params
        : { ...params, pattern: expandSpecialChars(params.pattern) };
      const expandedReplacement = params.is_regex ? replaceText : expandSpecialChars(replaceText);
      // Rust takes an O(1) rope snapshot on commit, so Ctrl+Z / Ctrl+Y work for any
      // file size without loading the document into CodeMirror (see replaceUndo.ts).
      outcome = await cmd.replaceAll(bufferId, replaceParams, expandedReplacement);

      if (outcome && outcome.count > 0) {
        const info = outcome.file_info;
        noteReplaceAllDone(bufferId);
        setTabs((prev) => prev.map((tab) => (tab.bufferId === bufferId ? { ...tab, fileInfo: info } : tab)));
        // Old match offsets are meaningless now; drop them until the new search lands.
        setMatches([]);
        setTotal(0);
        setCurrentIdx(-1);
        clearSearchHighlights(bufferId);
        markSearchStale(bufferId);
        await reloadCurrentWindow(bufferId);
      }
    } catch (err) {
      console.error('[SearchPanel] Replace All failed:', err);
      showToast(t('search.replaceFailed', { error: String(err) }));
      return;
    } finally {
      runningRef.current = false;
      setProgress(null);
    }

    if (!outcome) {
      showToast(t('search.replaceCancelled'));
      return;
    }

    onReplaced();
    showToast(t('search.replacedCount', { count: outcome.count }));
    // Hand focus back to the editor so Ctrl+Z / Ctrl+Y reach CodeMirror instead of
    // the (focused) Replace All button. Search/replace always operates on the primary
    // pane's tab; only return focus to the secondary pane when it shows that buffer.
    const focusPane = activePane === 'secondary' && secondaryActiveTab?.bufferId === bufferId
      ? 'secondary'
      : 'primary';
    focusEditor(bufferId, focusPane, { force: true });
    if (outcome.count === 0) {
      // Rust just scanned the whole buffer with the same pattern: nothing to find.
      applyEmptyResult();
      return;
    }
    // Refresh the match list in the background (a full scan on huge files).
    void doSearch({ noScroll: true });
  };
}
