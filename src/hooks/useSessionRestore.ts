import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { v4 as uuidv4 } from 'uuid';
import { tabsAtom, activeTabIdAtom } from '../store/atoms';
import * as cmd from '../store/tauriCommands';
import { useFile } from './useFile';
import { pathsEqual } from '../utils/pathUtils';
import type { TabState } from '../types';

/**
 * On app mount, restores the previous session, then opens a CLI / Explorer file if any.
 *
 * Strategy:
 * 1. Load session JSON.
 * 2. Immediately clear it (prevents infinite restore loop if a tab crashes on open).
 * 3. For each saved tab:
 *    - If scratch_path is set  → load content from scratch file (modified/unsaved buffer)
 *    - If path is set          → open the original file from disk (clean state)
 * 4. Set tabsAtom + activeTabIdAtom.
 * 5. Call `getStartupFile` and open that path **after** step 4 so restore cannot overwrite it.
 * 6. Errors on individual tabs are swallowed so a missing file doesn't block all others.
 */
export function useSessionRestore() {
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);
  const { openFile } = useFile();

  useEffect(() => {
    let cancelled = false;

    async function openExplorerStartupFile(restoredTabs: TabState[]) {
      if (cancelled) return;
      let path: string | null;
      try {
        path = await cmd.getStartupFile();
      } catch (e) {
        console.error('[useSessionRestore] Failed to read startup file:', e);
        return;
      }
      if (!path) return;

      const existing = restoredTabs.find(
        (t) => t.fileInfo.path && pathsEqual(t.fileInfo.path, path),
      );
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      try {
        await openFile(path);
      } catch (e) {
        console.error('[useSessionRestore] Failed to open startup file:', path, e);
      }
    }

    async function restore() {
      let session: Awaited<ReturnType<typeof cmd.loadSession>>;
      try {
        session = await cmd.loadSession();
      } catch (e) {
        console.error('[useSessionRestore] Failed to load session:', e);
        await openExplorerStartupFile([]);
        return;
      }

      if (!session || session.tabs.length === 0) {
        await openExplorerStartupFile([]);
        return;
      }

      // Delete session.json early so a crash during restore doesn't loop.
      // Scratch files are NOT deleted here – they are needed just below.
      // Each openScratchAsBuffer call deletes its own file; remaining orphans
      // are cleaned up by cleanupScratchDir at the end of this function.
      try {
        await cmd.clearSession();
      } catch (e) {
        console.error('[useSessionRestore] Failed to clear session:', e);
      }

      const restoredTabs: TabState[] = [];

      for (const tabSession of session.tabs) {
        if (cancelled) break;
        try {
          let fileInfo: Awaited<ReturnType<typeof cmd.openFile>>;

          if (tabSession.scratch_path) {
            // Restore unsaved / modified content from scratch
            fileInfo = await cmd.openScratchAsBuffer(
              tabSession.scratch_path,
              tabSession.path,
              tabSession.encoding,
              tabSession.line_ending,
            );
          } else if (tabSession.path) {
            // Clean saved file – just re-open from disk
            fileInfo = await cmd.openFile(tabSession.path);
          } else {
            // Empty new buffer (no path, no content) – recreate as new buffer
            fileInfo = await cmd.newBuffer();
          }

          restoredTabs.push({
            id: uuidv4(),
            bufferId: fileInfo.id,
            fileInfo,
            cursorLine: tabSession.cursor_line,
            cursorCol: tabSession.cursor_col,
            scrollTop: tabSession.scroll_top,
            language: tabSession.language,
          });
        } catch (e) {
          console.warn(
            '[useSessionRestore] Could not restore tab:',
            tabSession.path || '(unsaved)',
            e,
          );
        }
      }

      // Bail out early if this effect instance was cancelled (React Strict Mode
      // unmounts the first instance before it finishes). Do NOT clean scratch
      // files here – the second instance still needs them.
      if (cancelled) return;

      if (restoredTabs.length > 0) {
        try {
          await cmd.cleanupScratchDir();
        } catch (e) {
          console.warn('[useSessionRestore] Failed to clean scratch dir:', e);
        }

        setTabs(restoredTabs);
        const activeIdx = Math.min(session.active_tab_index, restoredTabs.length - 1);
        setActiveTabId(restoredTabs[activeIdx]?.id ?? null);
      }

      await openExplorerStartupFile(restoredTabs);
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, [setTabs, setActiveTabId, openFile]);
}
