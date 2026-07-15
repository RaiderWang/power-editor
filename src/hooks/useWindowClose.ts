import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { tabsAtom, activeTabIdAtom } from '../store/atoms';
import { syncEditorToRust } from '../store/editorViewRegistry';
import * as cmd from '../store/tauriCommands';
import type { TabSession } from '../types/session';

/**
 * Intercepts the `app:close-requested` event emitted by Rust when the user
 * clicks the window close button. Saves the current session (including
 * temporary scratch files for unsaved/modified buffers), then tells Rust
 * to exit cleanly via `confirm_close_app`.
 */
export function useWindowClose() {
  const tabs = useAtomValue(tabsAtom);
  const activeTabId = useAtomValue(activeTabIdAtom);

  // Use refs so the async event handler always sees the latest state without
  // needing to re-register the listener every render.
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let active = true; // becomes false when this effect instance is cleaned up

    listen('app:close-requested', async () => {
      const currentTabs = tabsRef.current;
      const currentActiveTabId = activeTabIdRef.current;

      try {
        const tabSessions: TabSession[] = [];

        for (const tab of currentTabs) {
          if (tab.fileInfo.is_modified) {
            // Flush current CM window edits to the Rust rope first
            await syncEditorToRust(tab.bufferId);

            let scratchPath: string;
            try {
              scratchPath = await cmd.exportBufferToScratch(tab.bufferId);
            } catch (scratchErr) {
              throw scratchErr;
            }

            tabSessions.push({
              path: tab.fileInfo.path ?? '',
              scratch_path: scratchPath,
              cursor_line: tab.cursorLine,
              cursor_col: tab.cursorCol,
              scroll_top: tab.scrollTop,
              language: tab.language,
              encoding: tab.fileInfo.encoding,
              line_ending: tab.fileInfo.line_ending,
            });
          } else {
            // Clean saved file – just remember the path and cursor
            tabSessions.push({
              path: tab.fileInfo.path ?? '',
              scratch_path: null,
              cursor_line: tab.cursorLine,
              cursor_col: tab.cursorCol,
              scroll_top: tab.scrollTop,
              language: tab.language,
              encoding: tab.fileInfo.encoding,
              line_ending: tab.fileInfo.line_ending,
            });
          }
        }

        const activeIndex = currentTabs.findIndex((t) => t.id === currentActiveTabId);

        await cmd.saveSession({
          active_tab_index: Math.max(0, activeIndex),
          tabs: tabSessions,
        });
      } catch (e) {
        console.error('[useWindowClose] Failed to save session:', e);
        // Proceed with close even if session save fails
      }

      await cmd.confirmCloseApp();
    }).then((fn) => {
      if (active) {
        unlistenFn = fn; // still mounted, hold the reference for cleanup
      } else {
        fn(); // already cleaned up while the promise was in-flight, unregister now
      }
    });

    return () => {
      active = false;
      unlistenFn?.(); // unregister if promise already resolved
    };
  }, []); // Register once; reads state through refs
}
