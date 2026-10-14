import { useMemo } from 'react';
import type { EditorView } from '@codemirror/view';
import { undo, redo, deleteLine } from '@codemirror/commands';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  editorPrefsAtom,
  columnModeAtom,
  searchOpenAtom,
  searchTriggerAtom,
} from '../../../store/atoms';
import {
  canPreviewAtom,
  isPreviewOpenAtom,
  toggleMarkdownPreviewAtom,
} from '../../../store/previewAtoms';
import {
  customKeybindingsAtom,
  getEffectiveShortcut,
} from '../../../store/keybindings';
import { writeClipboardText } from '../../../utils/clipboard';
import { getTranslation } from '../../../i18n';
import type { TabState } from '../../../types';
import type { EditorContextMenuItem } from './types';
import {
  canUndo,
  canRedo,
  hasSelection,
  copySelection,
  cutSelection,
  pasteFromClipboard,
  transformSelectionCase,
} from './editCommands';

interface UseEditorContextMenuItemsOptions {
  view: EditorView | null;
  tab: TabState;
  onSelectAll: () => void;
}

export function useEditorContextMenuItems({
  view,
  tab,
  onSelectAll,
}: UseEditorContextMenuItemsOptions): EditorContextMenuItem[] {
  const [prefs, setPrefs] = useAtom(editorPrefsAtom);
  // `useTranslation()` returns a brand-new function on every render, which would
  // invalidate the useMemo below each time and (via the menu's layout effect)
  // cause an infinite render loop. Memoise on locale instead.
  const locale = prefs.locale;
  const t = useMemo(() => getTranslation(locale), [locale]);
  const [columnMode, setColumnMode] = useAtom(columnModeAtom);
  const canPreview = useAtomValue(canPreviewAtom);
  const isPreviewOpen = useAtomValue(isPreviewOpenAtom);
  const toggleMarkdownPreview = useSetAtom(toggleMarkdownPreviewAtom);
  const setSearchOpen = useSetAtom(searchOpenAtom);
  const setSearchTrigger = useSetAtom(searchTriggerAtom);
  const customs = useAtomValue(customKeybindingsAtom);

  return useMemo(() => {
    if (!view) return [];

    const isReadOnly = Boolean(tab.readOnly || tab.fileInfo.is_read_only);
    const hasSel = hasSelection(view);
    const undoable = !isReadOnly && canUndo(view);
    const redoable = !isReadOnly && canRedo(view);
    const hasPath = Boolean(tab.fileInfo.path);

    const shortcut = (id: string) => getEffectiveShortcut(id, customs);

    const items: EditorContextMenuItem[] = [
      // History group
      {
        id: 'undo',
        label: t('keybinding.editor.undo'),
        shortcut: shortcut('editor.undo'),
        disabled: !undoable,
        onClick: () => { undo(view); },
      },
      {
        id: 'redo',
        label: t('keybinding.editor.redo'),
        shortcut: shortcut('editor.redo'),
        disabled: !redoable,
        onClick: () => { redo(view); },
      },
      { separator: true, label: 'sep-history' },

      // Clipboard and selection group
      {
        id: 'cut',
        label: t('keybinding.editor.cut'),
        shortcut: shortcut('editor.cut'),
        disabled: isReadOnly,
        onClick: () => { void cutSelection(view, isReadOnly); },
      },
      {
        id: 'copy',
        label: t('keybinding.editor.copy'),
        shortcut: shortcut('editor.copy'),
        disabled: false,
        onClick: () => { void copySelection(view); },
      },
      {
        id: 'paste',
        label: t('keybinding.editor.paste'),
        shortcut: shortcut('editor.paste'),
        disabled: isReadOnly,
        onClick: () => { void pasteFromClipboard(view, isReadOnly); },
      },
      {
        id: 'selectAll',
        label: t('keybinding.editor.selectAll'),
        shortcut: shortcut('editor.selectAll'),
        disabled: false,
        onClick: onSelectAll,
      },
      { separator: true, label: 'sep-edit' },

      // Search & code manipulation
      {
        id: 'find',
        label: t('menu.edit.findReplace'),
        shortcut: shortcut('search.find'),
        disabled: false,
        keepFocus: true,
        onClick: () => {
          setSearchOpen(true);
          setSearchTrigger((n) => n + 1);
        },
      },
      {
        id: 'deleteLine',
        label: t('menu.edit.deleteLine'),
        shortcut: shortcut('edit.deleteLine'),
        disabled: isReadOnly,
        onClick: () => { deleteLine(view); },
      },
      {
        id: 'toUpperCase',
        label: t('menu.edit.toUpperCase'),
        shortcut: shortcut('edit.toUpperCase'),
        disabled: isReadOnly || !hasSel,
        onClick: () => { transformSelectionCase(view, 'upper'); },
      },
      {
        id: 'toLowerCase',
        label: t('menu.edit.toLowerCase'),
        shortcut: shortcut('edit.toLowerCase'),
        disabled: isReadOnly || !hasSel,
        onClick: () => { transformSelectionCase(view, 'lower'); },
      },
      { separator: true, label: 'sep-view' },

      // View options
      {
        id: 'lineWrap',
        label: t('menu.view.lineWrap'),
        shortcut: shortcut('view.lineWrap'),
        checked: prefs.lineWrap,
        onClick: () => { setPrefs((p) => ({ ...p, lineWrap: !p.lineWrap })); },
      },
      {
        id: 'columnMode',
        label: t('menu.view.columnMode'),
        shortcut: shortcut('view.columnMode'),
        checked: columnMode,
        onClick: () => { setColumnMode((v) => !v); },
      },
    ];

    if (canPreview) {
      items.push({
        id: 'markdownPreview',
        label: t('menu.view.markdownPreview'),
        shortcut: shortcut('view.markdownPreview'),
        checked: isPreviewOpen,
        onClick: () => { toggleMarkdownPreview(); },
      });
    }

    // Utility group
    items.push(
      { separator: true, label: 'sep-path' },
      {
        id: 'copyPath',
        label: t('menu.edit.copyPath'),
        shortcut: shortcut('edit.copyPath'),
        disabled: !hasPath,
        onClick: () => {
          if (tab.fileInfo.path) {
            void writeClipboardText(tab.fileInfo.path);
          }
        },
      },
    );

    return items;
  }, [
    view,
    tab,
    prefs.lineWrap,
    columnMode,
    canPreview,
    isPreviewOpen,
    customs,
    t,
    onSelectAll,
    setPrefs,
    setColumnMode,
    toggleMarkdownPreview,
    setSearchOpen,
    setSearchTrigger,
  ]);
}
