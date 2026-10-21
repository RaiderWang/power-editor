import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { tabsAtom, activeTabIdAtom } from '../store/atoms';
import { persistAppSession } from '../utils/sessionPersist';
import * as cmd from '../store/tauriCommands';

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
        await persistAppSession(currentTabs, currentActiveTabId);
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
