import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { tabsAtom, activeTabIdAtom, pendingCloseTabIdAtom, pendingLargeFileAtom, pendingBinaryFileAtom, editorPrefsAtom } from '../store/atoms';
import type { PendingLargeFile, PendingBinaryFile } from '../store/atoms';
import * as cmd from '../store/tauriCommands';
import { syncEditorToRust, clearTextEdited } from '../store/editorViewRegistry';
import { recentFilesAtom, addToRecent, saveRecentFiles } from '../store/recentFiles';
import { pathsEqual } from '../utils/pathUtils';
import type { TabState } from '../types';

/** Files larger than this trigger a confirmation dialog before opening (500 MB). */
const LARGE_FILE_WARN_BYTES = 500 * 1024 * 1024;

export function useFile() {
  const [tabs, setTabs] = useAtom(tabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);
  const setPendingCloseTabId = useSetAtom(pendingCloseTabIdAtom);
  const setPendingLargeFile = useSetAtom(pendingLargeFileAtom);
  const setPendingBinaryFile = useSetAtom(pendingBinaryFileAtom);
  const setRecentFiles = useSetAtom(recentFilesAtom);
  const prefs = useAtomValue(editorPrefsAtom);

  const openFile = useCallback(async (path: string) => {
    // If the file is already open in a tab, switch to it instead of duplicating.
    const existing = tabs.find(
      (t) => t.fileInfo.path && pathsEqual(t.fileInfo.path, path),
    );
    if (existing) {
      setActiveTabId(existing.id);
      return existing;
    }

    // Large file size guard (metadata check, zero content I/O)
    try {
      const fileSize = await cmd.getFileSize(path);
      if (fileSize >= LARGE_FILE_WARN_BYTES && prefs.warnOnLargeFile) {
        const confirmed = await new Promise<boolean>((resolve) => {
          const pending: PendingLargeFile = {
            path,
            sizeBytes: fileSize,
            resolve: () => resolve(true),
            reject: () => resolve(false),
          };
          setPendingLargeFile(pending);
        });
        setPendingLargeFile(null);
        if (!confirmed) return undefined;
      }
    } catch {
      // If metadata check fails, proceed to open (Tauri will report file open errors)
    }

    // Unified single-pass open: Phase 1 reads first chunk and detects both encoding & binary characteristics in one step
    const requestId = uuidv4();
    let fileInfo;
    try {
      fileInfo = await cmd.openFile(path, requestId);
    } catch (err) {
      console.error('[useFile] openFile failed for', path, err);
      throw err;
    }

    // Binary file detected: prompt user for read-only vs cancel
    if (fileInfo.is_binary) {
      const decision = await new Promise<'readonly' | 'cancel'>((resolve) => {
        const pending: PendingBinaryFile = {
          path,
          sizeBytes: fileInfo.total_bytes,
          resolve: () => resolve('readonly'),
          reject: () => resolve('cancel'),
        };
        setPendingBinaryFile(pending);
      });
      setPendingBinaryFile(null);

      if (decision === 'cancel') {
        // User cancelled: discard buffer immediately from Rust registry
        await cmd.closeBuffer(fileInfo.id).catch(console.error);
        return undefined;
      }
    }

    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const tab: TabState = {
      id: uuidv4(),
      bufferId: fileInfo.id,
      fileInfo,
      cursorLine: 0,
      cursorCol: 0,
      scrollTop: 0,
      language: ext || null,
      readOnly: fileInfo.is_read_only,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setRecentFiles((prev) => {
      const next = addToRecent(prev, path);
      saveRecentFiles(next);
      return next;
    });
    return tab;
  }, [tabs, setActiveTabId, setPendingBinaryFile, setPendingLargeFile, setTabs, setRecentFiles, prefs.warnOnLargeFile]);

  const newFile = useCallback(async () => {
    const fileInfo = await cmd.newBuffer();
    const tab: TabState = {
      id: uuidv4(),
      bufferId: fileInfo.id,
      fileInfo,
      cursorLine: 0,
      cursorCol: 0,
      scrollTop: 0,
      language: null,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab;
  }, [setTabs, setActiveTabId]);

  // Performs the actual tab close without any confirmation dialog.
  const forceCloseTab = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      await cmd.closeBuffer(tab.bufferId);
    }
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => {
      if (prev !== tabId) return prev;
      const idx = tabs.findIndex((t) => t.id === tabId);
      const next = tabs.filter((t) => t.id !== tabId);
      return next[Math.min(idx, next.length - 1)]?.id ?? null;
    });
  }, [tabs, setTabs, setActiveTabId]);

  // Public close: if the tab has unsaved changes, shows the confirmation dialog.
  const closeTab = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.fileInfo.is_modified) {
      setPendingCloseTabId(tabId);
      return;
    }
    await forceCloseTab(tabId);
  }, [tabs, forceCloseTab, setPendingCloseTabId]);

  const saveFile = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.readOnly || tab.fileInfo.is_read_only) {
      // Direct overwrite forbidden for read-only / binary files to prevent corruption.
      console.warn('[useFile] saveFile blocked: tab is read-only');
      return;
    }
    if (!tab.fileInfo.path) return; // needs saveAs
    await syncEditorToRust(tab.bufferId);
    await cmd.saveBuffer(tab.bufferId);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, fileInfo: { ...t.fileInfo, is_modified: false } }
          : t
      )
    );
  }, [tabs, setTabs]);

  const saveFileAs = useCallback(async (tabId: string, path: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    await syncEditorToRust(tab.bufferId);
    const fileInfo = await cmd.saveBufferAs(tab.bufferId, path);
    if (tab.readOnly || tab.fileInfo.is_read_only) {
      await cmd.setReadOnly(tab.bufferId, false).catch(() => {});
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? {
        ...t,
        fileInfo: { ...fileInfo, is_read_only: false },
        readOnly: false,
        untitledName: undefined,
      } : t))
    );
    setRecentFiles((prev) => {
      const next = addToRecent(prev, path);
      saveRecentFiles(next);
      return next;
    });
  }, [tabs, setTabs, setRecentFiles]);

  const renameFile = useCallback(async (tabId: string, newFileName: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const ext = newFileName.split('.').pop()?.toLowerCase() ?? '';

    if (tab.fileInfo.path) {
      const oldPath = tab.fileInfo.path;
      const fileInfo = await cmd.renameBuffer(tab.bufferId, newFileName);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, fileInfo, language: ext || null }
            : t
        )
      );
      setRecentFiles((prev) => {
        const idx = prev.indexOf(oldPath);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = fileInfo.path;
        saveRecentFiles(next);
        return next;
      });
    } else {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, untitledName: newFileName, language: ext || null }
            : t
        )
      );
    }
  }, [tabs, setTabs, setRecentFiles]);

  const updateTabInfo = useCallback((tabId: string, updates: Partial<TabState>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
    );
  }, [setTabs]);

  const reopenWithEncoding = useCallback(async (tabId: string, encoding: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || !tab.fileInfo.path) return;
    if (encoding === tab.fileInfo.encoding) return;
    try {
      const newInfo = await cmd.reopenWithEncoding(tab.bufferId, encoding);
      clearTextEdited(tab.bufferId);
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, bufferId: newInfo.id, fileInfo: newInfo } : t))
      );
    } catch (err) {
      console.error('[useFile] reopenWithEncoding failed:', err);
      throw err;
    }
  }, [tabs, setTabs]);

  return { openFile, newFile, closeTab, forceCloseTab, saveFile, saveFileAs, renameFile, reopenWithEncoding, updateTabInfo };
}
