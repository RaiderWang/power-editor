import type { createStore } from 'jotai';
import { searchOpenAtom, tabsAtom } from './atoms';
import {
  clearSearchHighlights,
  focusEditor,
  hasUnsyncedEdits,
  highlightSearchMatches,
  jumpToLine,
  whenEditorReady,
} from './editorViewRegistry';
import type { TabState } from '../types';
import type { LineHit } from '../types/workspaceSearch';

type Store = ReturnType<typeof createStore>;

export type RevealOutcome = 'exact' | 'approximate' | 'failed';

/** How long to wait for the editor's first load. */
const EDITOR_READY_TIMEOUT_MS = 10_000;
/** Longest wait for a big file's background (Phase 2) load to reach the target line. */
const LOAD_COVERAGE_TIMEOUT_MS = 10 * 60_000;

/** Buffer whose editor currently shows highlights created by `revealMatchInBuffer`. */
let revealedBufferId: number | null = null;
/** Only the newest reveal may finish; an older, still-waiting one gives up. */
let revealToken = 0;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Removes the match highlight left by the last reveal. Skipped while the in-file find
 * panel (Ctrl+F) is open: it owns the highlights then.
 */
export function clearRevealedHighlight(findPanelOpen: boolean): void {
  const id = revealedBufferId;
  if (id === null || findPanelOpen) return;
  revealedBufferId = null;
  clearSearchHighlights(id);
}

function findTab(store: Store, tabId: string): TabState | undefined {
  return store.get(tabsAtom).find((t) => t.id === tabId);
}

/** The target line is available in the Rope AND known to the editor (Phase 2 progress). */
function lineCovered(tab: TabState, line: number): boolean {
  // `+ 1`: while loading, the last line of the Rope may be cut mid-line.
  return tab.fileInfo.is_fully_loaded || line + 1 < tab.fileInfo.total_lines;
}

/**
 * >4 MB files are opened in two phases and `tab.fileInfo.total_lines` only covers what is
 * loaded so far (the editor clamps jumps to it). Wait until the target line is covered.
 */
async function waitForLineCoverage(
  store: Store,
  tabId: string,
  line: number,
  token: number,
): Promise<boolean> {
  const first = findTab(store, tabId);
  if (!first) return false;
  if (lineCovered(first, line)) return true;

  return new Promise<boolean>((resolve) => {
    let timer = 0;
    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve(ok);
    };
    const check = () => {
      if (token !== revealToken) return finish(false);
      const tab = findTab(store, tabId);
      if (!tab) return finish(false);
      if (lineCovered(tab, line)) finish(true);
    };
    const unsubscribe = store.sub(tabsAtom, check);
    timer = window.setTimeout(() => finish(false), LOAD_COVERAGE_TIMEOUT_MS);
  });
}

export interface RevealRequest {
  store: Store;
  tabId: string;
  hit: LineHit;
  /** Encoding the search scanner used to compute `hit.from/to`. */
  encoding: string;
  /** Non-blocking user notification (toast). */
  notify: (message: string) => void;
  /** Localised messages. */
  messages: { approximate: string; loadFailed: string };
}

/**
 * Brings a folder-search hit into view in the (already opened) tab and puts the caret on it.
 *
 * Exact: the disk offsets are Rope coordinates, so highlight + select the match.
 * Approximate (line only): the buffer was edited/re-encoded since, offsets may be stale.
 */
export async function revealMatchInBuffer(req: RevealRequest): Promise<RevealOutcome> {
  const { store, tabId, hit, encoding, notify, messages } = req;
  const token = ++revealToken;

  const tab0 = findTab(store, tabId);
  if (!tab0) return 'failed';
  let bufferId = tab0.bufferId;

  // 1. The editor must have finished its first load (it would overwrite our jump).
  //    A `false` result means: timeout, or the editor was torn down while we waited. The
  //    teardown may be temporary (a just-opened tab's editor being re-created, e.g. React
  //    StrictMode's dev double mount) or a buffer swap (re-open with another encoding), so
  //    keep waiting for the tab's current buffer until the overall deadline.
  const deadline = Date.now() + EDITOR_READY_TIMEOUT_MS;
  for (;;) {
    const remaining = deadline - Date.now();
    const ready = remaining > 0 && (await whenEditorReady(bufferId, remaining));
    if (token !== revealToken) return 'failed';
    if (ready) break;
    const current = findTab(store, tabId);
    if (!current) return 'failed'; // tab closed: nothing to tell the user
    if (Date.now() >= deadline) {
      notify(messages.loadFailed);
      return 'failed';
    }
    bufferId = current.bufferId;
  }

  // 2. Large files: wait for the background load to cover the target line.
  if (!(await waitForLineCoverage(store, tabId, hit.line, token))) return 'failed';
  // Let the editor's effect sync its total line count from the tab first.
  await nextFrame();
  await nextFrame();
  if (token !== revealToken) return 'failed';

  const tab = findTab(store, tabId);
  if (!tab) return 'failed';

  // 3. Disk offsets are only valid for an unmodified buffer decoded the same way.
  const exact =
    !(tab.fileInfo.is_modified || hasUnsyncedEdits(bufferId)) && tab.fileInfo.encoding === encoding;

  let outcome: RevealOutcome;
  if (revealedBufferId !== null && revealedBufferId !== bufferId) {
    clearRevealedHighlight(store.get(searchOpenAtom));
  }
  if (exact) {
    await highlightSearchMatches(
      bufferId,
      [{ from: hit.from, to: hit.to, line: hit.line, column: 0, preview: hit.preview }],
      0,
      false,
      { selectCurrent: true },
    );
    revealedBufferId = bufferId;
    outcome = 'exact';
  } else {
    const jumped = await jumpToLine(bufferId, hit.line);
    if (!jumped) return 'failed';
    notify(messages.approximate);
    outcome = 'approximate';
  }

  focusEditor(bufferId, 'primary', { force: true });
  return outcome;
}
