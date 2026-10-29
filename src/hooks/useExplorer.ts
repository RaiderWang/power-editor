import { useStore, useAtom, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { open, ask, message } from '@tauri-apps/plugin-dialog';
import {
  currentFolderPathAtom,
  sidebarVisibleAtom,
  sidebarWidthAtom,
  selectedPathAtom,
  expandedFoldersAtom,
  explorerRefreshTriggerAtom,
} from '../store/explorerAtoms';
import { tabsAtom } from '../store/atoms';
import * as cmd from '../store/tauriCommands';
import { useFile } from './useFile';
import { useTranslation } from '../i18n';
import { joinPath, getParentDir, getRelativePath, rebasePath, pathsEqual, isPathInsideFolder, getFileExtension } from '../utils/pathUtils';

const STORAGE_FOLDER_KEY = 'power-editor:folder-path';
const STORAGE_SIDEBAR_VISIBLE_KEY = 'power-editor:sidebar-visible';
const STORAGE_SIDEBAR_WIDTH_KEY = 'power-editor:sidebar-width';

export function useExplorer() {
  const store = useStore();
  const [currentFolderPath, setCurrentFolderPath] = useAtom(currentFolderPathAtom);
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [selectedPath, setSelectedPath] = useAtom(selectedPathAtom);
  const [expandedFolders, setExpandedFolders] = useAtom(expandedFoldersAtom);
  const setRefreshTrigger = useSetAtom(explorerRefreshTriggerAtom);
  const setTabs = useSetAtom(tabsAtom);
  const { openFile, closeTab } = useFile();
  const t = useTranslation();

  const setStoredFolderPath = useCallback((path: string | null) => {
    setCurrentFolderPath(path);
    try {
      if (path) {
        localStorage.setItem(STORAGE_FOLDER_KEY, path);
      } else {
        localStorage.removeItem(STORAGE_FOLDER_KEY);
      }
    } catch {
      // ignore localStorage errors
    }
  }, [setCurrentFolderPath]);

  const setStoredSidebarVisible = useCallback((visible: boolean) => {
    setSidebarVisible(visible);
    try {
      localStorage.setItem(STORAGE_SIDEBAR_VISIBLE_KEY, String(visible));
    } catch {
      // ignore
    }
  }, [setSidebarVisible]);

  const setStoredSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(width);
    try {
      localStorage.setItem(STORAGE_SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // ignore
    }
  }, [setSidebarWidth]);

  const openFolderPath = useCallback((path: string) => {
    setStoredFolderPath(path);
    setStoredSidebarVisible(true);
    setExpandedFolders([]);
    setSelectedPath(null);
    setRefreshTrigger((n) => n + 1);
  }, [setStoredFolderPath, setStoredSidebarVisible, setExpandedFolders, setSelectedPath, setRefreshTrigger]);

  const openFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selected === 'string' && selected) {
        openFolderPath(selected);
      }
    } catch (err) {
      console.error('[useExplorer] openFolder failed:', err);
      await message(String(err), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [openFolderPath, t]);

  const closeFolder = useCallback(async () => {
    if (!currentFolderPath) return;

    // 1. Identify all open tabs belonging to currentFolderPath
    const currentTabs = store.get(tabsAtom);
    const folderTabs = currentTabs.filter(
      (tab) => tab.fileInfo.path && isPathInsideFolder(tab.fileInfo.path, currentFolderPath),
    );

    // 2. Sequentially close each folder tab; abort if user cancels unsaved confirm dialog
    for (const tab of folderTabs) {
      const closed = await closeTab(tab.id);
      if (!closed) {
        return;
      }
    }

    // 3. Clear current folder state and close the sidebar/folder panel
    setStoredFolderPath(null);
    setSelectedPath(null);
    setExpandedFolders([]);
    setStoredSidebarVisible(false);
  }, [currentFolderPath, store, closeTab, setStoredFolderPath, setStoredSidebarVisible, setSelectedPath, setExpandedFolders]);

  const toggleSidebar = useCallback(() => {
    setStoredSidebarVisible(!sidebarVisible);
  }, [sidebarVisible, setStoredSidebarVisible]);

  const refreshTree = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
  }, [setRefreshTrigger]);

  const toggleFolderExpansion = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const exists = prev.some((p) => pathsEqual(p, folderPath));
      if (exists) {
        return prev.filter((p) => !pathsEqual(p, folderPath));
      }
      return [...prev, folderPath];
    });
  }, [setExpandedFolders]);

  const collapseAllFolders = useCallback(() => {
    setExpandedFolders([]);
  }, [setExpandedFolders]);

  const createNewFile = useCallback(async (parentDir: string, fileName: string) => {
    const fullPath = joinPath(parentDir, fileName.trim());
    try {
      await cmd.createFile(fullPath);
      // Auto expand parent directory
      setExpandedFolders((prev) => (prev.some((p) => pathsEqual(p, parentDir)) ? prev : [...prev, parentDir]));
      setRefreshTrigger((n) => n + 1);
      // Open the new file immediately
      await openFile(fullPath);
    } catch (err) {
      console.error('[useExplorer] createFile failed:', err);
      await message(String(err), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [setExpandedFolders, setRefreshTrigger, openFile, t]);

  const createNewDirectory = useCallback(async (parentDir: string, dirName: string) => {
    const fullPath = joinPath(parentDir, dirName.trim());
    try {
      await cmd.createDirectory(fullPath);
      // Auto expand parent directory
      setExpandedFolders((prev) => (prev.some((p) => pathsEqual(p, parentDir)) ? prev : [...prev, parentDir]));
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      console.error('[useExplorer] createDirectory failed:', err);
      await message(String(err), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [setExpandedFolders, setRefreshTrigger, t]);

  const renameItem = useCallback(async (oldPath: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const parentDir = getParentDir(oldPath);
    const newPath = joinPath(parentDir, trimmed);
    if (pathsEqual(oldPath, newPath)) return;

    try {
      await cmd.renamePath(oldPath, newPath);
      // Update any open tabs with this path
      const ext = getFileExtension(trimmed) || null;
      setTabs((prev) =>
        prev.map((tab) => {
          const tabPath = tab.fileInfo.path;
          if (!tabPath) return tab;
          const rebased = rebasePath(tabPath, oldPath, newPath);
          if (rebased === null) return tab;
          // Renamed file itself: also re-detect language. A folder was renamed:
          // re-root tabs of files inside it (Rust side already relocated the
          // buffers' paths and watches).
          return {
            ...tab,
            fileInfo: { ...tab.fileInfo, path: rebased },
            ...(pathsEqual(tabPath, oldPath) ? { language: ext } : {}),
          };
        })
      );
      // Re-root expanded folders and the selection, including descendants of a
      // renamed folder, so sub-folders stay expanded and the selection stays valid.
      setExpandedFolders((prev) =>
        prev.map((p) => rebasePath(p, oldPath, newPath) ?? p)
      );
      if (selectedPath) {
        const rebasedSelection = rebasePath(selectedPath, oldPath, newPath);
        if (rebasedSelection !== null) setSelectedPath(rebasedSelection);
      }
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      console.error('[useExplorer] renamePath failed:', err);
      await message(String(err), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [selectedPath, setSelectedPath, setTabs, setExpandedFolders, setRefreshTrigger, t]);

  const deleteItem = useCallback(async (path: string, isDir: boolean, itemName: string) => {
    const confirmed = await ask(
      t('explorer.deleteConfirm', { name: itemName }),
      {
        title: t('explorer.deleteTitle'),
        kind: 'warning',
        okLabel: t('explorer.deleteOk'),
        cancelLabel: t('explorer.deleteCancel'),
      }
    );
    if (!confirmed) return;

    try {
      // Close tabs for this file or any file inside this folder *before* deleting
      // on disk. Otherwise a tab with unsaved edits would sit behind the close
      // confirmation while the file watcher reports it as "externally deleted"
      // (two stacked dialogs). If the user cancels any close, nothing is deleted.
      const currentTabs = store.get(tabsAtom);
      const tabsToClose = currentTabs.filter((tab) => {
        if (!tab.fileInfo.path) return false;
        if (isDir) {
          return isPathInsideFolder(tab.fileInfo.path, path);
        }
        return pathsEqual(tab.fileInfo.path, path);
      });
      for (const tab of tabsToClose) {
        const closed = await closeTab(tab.id);
        if (!closed) return;
      }
      await cmd.deletePath(path);
      if (selectedPath && pathsEqual(selectedPath, path)) {
        setSelectedPath(null);
      }
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      console.error('[useExplorer] deletePath failed:', err);
      await message(String(err), { title: t('dialog.openFailed'), kind: 'error' });
    }
  }, [store, selectedPath, setSelectedPath, closeTab, setRefreshTrigger, t]);

  const revealPath = useCallback(async (path: string) => {
    try {
      await cmd.revealInExplorer(path);
    } catch (err) {
      console.error('[useExplorer] revealInExplorer failed:', err);
    }
  }, []);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('[useExplorer] copyPath failed:', err);
    }
  }, []);

  const copyRelativePath = useCallback(async (path: string) => {
    if (!currentFolderPath) return;
    try {
      const rel = getRelativePath(currentFolderPath, path);
      await navigator.clipboard.writeText(rel);
    } catch (err) {
      console.error('[useExplorer] copyRelativePath failed:', err);
    }
  }, [currentFolderPath]);

  return {
    currentFolderPath,
    sidebarVisible,
    sidebarWidth,
    selectedPath,
    expandedFolders,
    setSidebarWidth: setStoredSidebarWidth,
    setSelectedPath,
    openFolder,
    openFolderPath,
    closeFolder,
    toggleSidebar,
    refreshTree,
    toggleFolderExpansion,
    collapseAllFolders,
    createNewFile,
    createNewDirectory,
    renameItem,
    deleteItem,
    revealPath,
    copyPath,
    copyRelativePath,
  };
}
