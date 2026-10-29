import { useEffect, useRef, useCallback } from 'react';
import { useAtom, useSetAtom, useStore } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import {
  tabsAtom,
  externalChangeTabIdAtom,
  externalDeletedTabIdsAtom,
  pendingCloseTabIdAtom,
} from '../store/atoms';
import * as cmd from '../store/tauriCommands';
import { clearTextEdited, reloadFromStart } from '../store/editorViewRegistry';

/**
 * Listens for external file events from the Rust file watcher.
 *
 * `file:externally-modified`
 * - If the affected buffer has no unsaved edits → auto-reload silently.
 * - If the buffer has unsaved edits → set `externalChangeTabIdAtom` so that
 *   `ExternalChangeDialog` can prompt the user.
 * - If the file reappeared after a deletion prompt, the stale deletion prompt
 *   is withdrawn and the change is handled as above.
 *
 * `file:externally-deleted`
 * - Queue the tab in `externalDeletedTabIdsAtom` so that `ExternalDeleteDialog`
 *   lets the user close the tab or save the content as a new file.
 *
 * Mount this hook once at the top of the component tree (App.tsx).
 */
export function useFileWatcher() {
  const store = useStore();
  const [tabs, setTabs] = useAtom(tabsAtom);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const setExternalChangeTabId = useSetAtom(externalChangeTabIdAtom);
  const setExternalDeletedTabIds = useSetAtom(externalDeletedTabIdsAtom);

  const performReload = useCallback(async (tabId: string, bufferId: number) => {
    try {
      const newInfo = await cmd.reloadBuffer(bufferId);
      // Clear the pending-sync flag so syncEditorToRust does not push stale CM
      // content back into the freshly reloaded Rust rope.
      clearTextEdited(bufferId);
      // Reset the virtual-window to line 0 and reload from the updated Rust rope.
      // We use reloadFromStart (not reloadCurrentWindow) so that the user always
      // sees the beginning of the freshly reloaded file, regardless of where the
      // virtual window was positioned before the external change was detected.
      await reloadFromStart(bufferId);
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, fileInfo: newInfo } : t)),
      );
    } catch (err) {
      console.error('[useFileWatcher] reload failed:', err);
    }
  }, [setTabs]);

  useEffect(() => {
    const unlistenPromise = listen<number>('file:externally-modified', (event) => {
      const bufferId = event.payload;
      const tab = tabsRef.current.find((t) => t.bufferId === bufferId);
      if (!tab) return;

      // The file is back on disk: withdraw any pending deletion prompt.
      setExternalDeletedTabIds((prev) => (prev.includes(tab.id) ? prev.filter((id) => id !== tab.id) : prev));

      if (!tab.fileInfo.is_modified) {
        performReload(tab.id, bufferId).catch(console.error);
      } else {
        setExternalChangeTabId(tab.id);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [performReload, setExternalChangeTabId, setExternalDeletedTabIds]);

  useEffect(() => {
    const unlistenPromise = listen<number>('file:externally-deleted', (event) => {
      const bufferId = event.payload;
      const tab = tabsRef.current.find((t) => t.bufferId === bufferId);
      if (!tab) return;
      // A close confirmation for this tab is already on screen: don't stack dialogs.
      if (store.get(pendingCloseTabIdAtom) === tab.id) return;

      // Deletion takes priority over a "modified on disk" prompt for the same tab.
      setExternalChangeTabId((prev) => (prev === tab.id ? null : prev));
      setExternalDeletedTabIds((prev) => (prev.includes(tab.id) ? prev : [...prev, tab.id]));
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [store, setExternalChangeTabId, setExternalDeletedTabIds]);
}
