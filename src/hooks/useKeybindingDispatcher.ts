import { useEffect, useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  customKeybindingsAtom,
  keybindingsDialogOpenAtom,
  buildShortcutMap,
  matchesEvent,
  getEffectiveShortcut,
  TAB_GOTO_PREFIX,
} from '../store/keybindings';
import { switchTabRelativeAtom, switchTabByIndexAtom } from '../store/tabNavigation';
import { replaceProgressAtom } from '../store/replaceProgress';
import {
  activeTabAtom,
  editorPrefsAtom,
  columnModeAtom,
  searchOpenAtom,
  searchTriggerAtom,
  reopenEncodingDialogOpenAtom,
} from '../store/atoms';
import { useFile } from './useFile';
import { useExplorer } from './useExplorer';
import { deleteCurrentLine, transformCase } from '../store/editorViewRegistry';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getTabSaveDefaultPath } from '../utils/tabFileName';
import { writeClipboardText } from '../utils/clipboard';
import { toggleMarkdownPreviewAtom } from '../store/previewAtoms';
import { usePrintActiveTab } from './usePrintActiveTab';
import { DEFAULT_PREFS } from '../store/editorPrefs';
import { adjustPreviewZoom, isPreviewFocused } from '../store/previewZoom';
import { PREVIEW_ZOOM_STEP } from '../store/previewZoomLimits';

type ActionHandler = () => void;

/**
 * Central keybinding dispatcher: listens for global keydown events and
 * maps them to registered action handlers based on the current keybinding
 * configuration (defaults + user overrides).
 */
export function useKeybindingDispatcher() {
  const customs = useAtomValue(customKeybindingsAtom);
  const shortcutsDialogOpen = useAtomValue(keybindingsDialogOpenAtom);
  // A running Replace All must not be disturbed by Ctrl+W, tab switching, etc.
  const replaceRunning = useAtomValue(replaceProgressAtom) !== null;
  const dialogOpen = shortcutsDialogOpen || replaceRunning;
  const activeTab = useAtomValue(activeTabAtom);
  const setPrefs = useSetAtom(editorPrefsAtom);
  const setColumnMode = useSetAtom(columnModeAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const setSearchTrigger = useSetAtom(searchTriggerAtom);
  const setReopenEncodingOpen = useSetAtom(reopenEncodingDialogOpenAtom);
  const toggleMarkdownPreview = useSetAtom(toggleMarkdownPreviewAtom);
  const switchTabRelative = useSetAtom(switchTabRelativeAtom);
  const switchTabByIndex = useSetAtom(switchTabByIndexAtom);
  const { handlePrint } = usePrintActiveTab();
  const { newFile, openFile, saveFile, saveFileAs, closeTab } = useFile();
  const { openFolder, closeFolder, currentFolderPath, toggleSidebar } = useExplorer();

  const shortcutMap = useMemo(() => buildShortcutMap(customs), [customs]);

  const getHandler = useCallback((actionId: string): ActionHandler | null => {
    const tab = activeTab;

    switch (actionId) {
      case 'file.new':
        return () => { newFile().catch(console.error); };
      case 'file.open':
        return () => {
          open({ multiple: false }).then((selected) => {
            if (typeof selected === 'string' && selected) openFile(selected).catch(console.error);
          }).catch(console.error);
        };
      case 'file.openFolder':
        return () => { openFolder(); };
      case 'file.closeFolder':
        return () => {
          if (currentFolderPath) {
            closeFolder().catch(console.error);
          }
        };
      case 'file.reopenWithEncoding':
        return () => {
          if (!tab?.fileInfo.path) return;
          setReopenEncodingOpen(true);
        };
      case 'file.save':
        return () => {
          if (!tab) return;
          if (!tab.fileInfo.path) {
            save({ defaultPath: getTabSaveDefaultPath(tab) }).then((savePath) => {
              if (savePath) saveFileAs(tab.id, savePath).catch(console.error);
            }).catch(console.error);
          } else {
            saveFile(tab.id).catch(console.error);
          }
        };
      case 'file.saveAs':
        return () => {
          if (!tab) return;
          save({ defaultPath: getTabSaveDefaultPath(tab) }).then((savePath) => {
            if (savePath) saveFileAs(tab.id, savePath).catch(console.error);
          }).catch(console.error);
        };
      case 'file.print':
        return () => { handlePrint().catch(console.error); };
      case 'file.closeTab':
        return () => { if (tab) closeTab(tab.id).catch(console.error); };
      case 'tab.next':
        return () => { switchTabRelative(1); };
      case 'tab.prev':
        return () => { switchTabRelative(-1); };
      case 'edit.deleteLine':
        return () => { if (tab) deleteCurrentLine(tab.bufferId); };
      case 'edit.toUpperCase':
        return () => { if (tab) transformCase(tab.bufferId, 'upper'); };
      case 'edit.toLowerCase':
        return () => { if (tab) transformCase(tab.bufferId, 'lower'); };
      case 'edit.copyPath':
        return () => {
          const path = tab?.fileInfo.path;
          if (path) void writeClipboardText(path);
        };
      case 'search.find':
        return () => { setSearchOpen(true); setSearchTrigger((n) => n + 1); };
      case 'search.nextMatch':
        return () => {
          document.dispatchEvent(new CustomEvent('keybinding:search.nextMatch'));
        };
      case 'search.prevMatch':
        return () => {
          document.dispatchEvent(new CustomEvent('keybinding:search.prevMatch'));
        };
      case 'view.toggleSidebar':
        return () => { toggleSidebar(); };
      case 'view.lineWrap':
        return () => { setPrefs((p) => ({ ...p, lineWrap: !p.lineWrap })); };
      case 'view.columnMode':
        return () => { setColumnMode((v) => !v); };
      case 'view.markdownPreview':
        return () => { toggleMarkdownPreview(); };
      // Font-size shortcuts follow focus: inside the Markdown preview they zoom the preview.
      case 'view.fontSizeUp':
        return () => {
          if (isPreviewFocused()) adjustPreviewZoom(setPrefs, PREVIEW_ZOOM_STEP);
          else setPrefs((p) => ({ ...p, fontSize: Math.min(48, p.fontSize + 1) }));
        };
      case 'view.fontSizeDown':
        return () => {
          if (isPreviewFocused()) adjustPreviewZoom(setPrefs, -PREVIEW_ZOOM_STEP);
          else setPrefs((p) => ({ ...p, fontSize: Math.max(8, p.fontSize - 1) }));
        };
      case 'view.fontSizeReset':
        return () => {
          if (isPreviewFocused()) adjustPreviewZoom(setPrefs, 'reset');
          else setPrefs((p) => ({ ...p, fontSize: DEFAULT_PREFS.fontSize }));
        };
      case 'view.toggleTheme':
        return () => { setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' })); };
      default: {
        if (actionId.startsWith(TAB_GOTO_PREFIX)) {
          const n = Number(actionId.slice(TAB_GOTO_PREFIX.length));
          if (Number.isInteger(n) && n >= 1 && n <= 9) return () => { switchTabByIndex(n); };
        }
        return null;
      }
    }
  }, [switchTabRelative, switchTabByIndex, activeTab, newFile, openFile, openFolder, closeFolder, currentFolderPath, toggleSidebar, saveFile, saveFileAs, handlePrint, closeTab, setSearchOpen, setSearchTrigger, setPrefs, setColumnMode, setReopenEncodingOpen, toggleMarkdownPreview]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (dialogOpen || e.isComposing || e.keyCode === 229) return;

      for (const [shortcutStr, actionId] of shortcutMap) {
        if (matchesEvent(shortcutStr, e)) {
          const run = getHandler(actionId);
          if (run) {
            e.preventDefault();
            run();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcutMap, getHandler, dialogOpen]);

  return { getEffectiveShortcut: (id: string) => getEffectiveShortcut(id, customs) };
}
