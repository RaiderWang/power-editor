import { useEffect, useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  customKeybindingsAtom,
  keybindingsDialogOpenAtom,
  buildShortcutMap,
  matchesEvent,
  getEffectiveShortcut,
} from '../store/keybindings';
import {
  activeTabAtom,
  editorPrefsAtom,
  columnModeAtom,
  searchOpenAtom,
  searchTriggerAtom,
} from '../store/atoms';
import { useFile } from './useFile';
import { deleteCurrentLine, transformCase } from '../store/editorViewRegistry';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getTabSaveDefaultPath } from '../utils/tabFileName';

type ActionHandler = () => void;

/**
 * Central keybinding dispatcher: listens for global keydown events and
 * maps them to registered action handlers based on the current keybinding
 * configuration (defaults + user overrides).
 */
export function useKeybindingDispatcher() {
  const customs = useAtomValue(customKeybindingsAtom);
  const dialogOpen = useAtomValue(keybindingsDialogOpenAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const setPrefs = useSetAtom(editorPrefsAtom);
  const setColumnMode = useSetAtom(columnModeAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const setSearchTrigger = useSetAtom(searchTriggerAtom);
  const { newFile, openFile, saveFile, saveFileAs, closeTab } = useFile();

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
      case 'file.closeTab':
        return () => { if (tab) closeTab(tab.id).catch(console.error); };
      case 'edit.deleteLine':
        return () => { if (tab) deleteCurrentLine(tab.bufferId); };
      case 'edit.toUpperCase':
        return () => { if (tab) transformCase(tab.bufferId, 'upper'); };
      case 'edit.toLowerCase':
        return () => { if (tab) transformCase(tab.bufferId, 'lower'); };
      case 'edit.copyPath':
        return () => {
          const path = tab?.fileInfo.path;
          if (path) navigator.clipboard.writeText(path).catch(console.error);
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
      case 'view.lineWrap':
        return () => { setPrefs((p) => ({ ...p, lineWrap: !p.lineWrap })); };
      case 'view.columnMode':
        return () => { setColumnMode((v) => !v); };
      case 'view.fontSizeUp':
        return () => { setPrefs((p) => ({ ...p, fontSize: Math.min(48, p.fontSize + 1) })); };
      case 'view.fontSizeDown':
        return () => { setPrefs((p) => ({ ...p, fontSize: Math.max(8, p.fontSize - 1) })); };
      case 'view.toggleTheme':
        return () => { setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' })); };
      default:
        return null;
    }
  }, [activeTab, newFile, openFile, saveFile, saveFileAs, closeTab, setSearchOpen, setSearchTrigger, setPrefs, setColumnMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (dialogOpen) return;

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
