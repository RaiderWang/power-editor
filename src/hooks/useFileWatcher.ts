import { useEffect, useRef, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { tabsAtom, externalChangeTabIdAtom } from '../store/atoms';
import * as cmd from '../store/tauriCommands';
import { clearTextEdited, reloadCurrentWindow } from '../store/editorViewRegistry';

/**
 * Listens for `file:externally-modified` events from the Rust file watcher.
 *
 * - If the affected buffer has no unsaved edits → auto-reload silently.
 * - If the buffer has unsaved edits → set `externalChangeTabIdAtom` so that
 *   `ExternalChangeDialog` can prompt the user.
 *
 * Mount this hook once at the top of the component tree (App.tsx).
 */
export function useFileWatcher() {
  const [tabs, setTabs] = useAtom(tabsAtom);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const setExternalChangeTabId = useSetAtom(externalChangeTabIdAtom);

  const performReload = useCallback(async (tabId: string, bufferId: number) => {
    try {
      const newInfo = await cmd.reloadBuffer(bufferId);
      // Clear the pending-sync flag so syncEditorToRust does not push stale CM
      // content back into the freshly reloaded Rust rope.
      clearTextEdited(bufferId);
      // Reload the CodeMirror view from the updated Rust rope.
      await reloadCurrentWindow(bufferId);
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

      if (!tab.fileInfo.is_modified) {
        performReload(tab.id, bufferId).catch(console.error);
      } else {
        setExternalChangeTabId(tab.id);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [performReload, setExternalChangeTabId]);

}
