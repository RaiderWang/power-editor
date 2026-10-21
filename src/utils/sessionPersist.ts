import type { TabState } from '../types';
import type { TabSession } from '../types/session';
import { syncEditorToRust } from '../store/editorViewRegistry';
import * as cmd from '../store/tauriCommands';

/**
 * Persists the current editor session (including unsaved scratch files)
 * to `app_data_dir/session.json`.
 * Shared between window close event and in-app update relaunch.
 */
export async function persistAppSession(tabs: TabState[], activeTabId: string | null): Promise<void> {
  const tabSessions: TabSession[] = [];

  for (const tab of tabs) {
    if (tab.fileInfo.is_modified) {
      // Flush current CM window edits to the Rust rope first
      await syncEditorToRust(tab.bufferId);

      const scratchPath = await cmd.exportBufferToScratch(tab.bufferId);

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

  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);

  await cmd.saveSession({
    active_tab_index: Math.max(0, activeIndex),
    tabs: tabSessions,
  });
}
