import { save } from '@tauri-apps/plugin-dialog';
import type { TabState } from '../../types';
import { getTabSaveDefaultPath } from '../../utils/tabFileName';
import { getBaseName } from '../../utils/pathUtils';
import { writeClipboardText } from '../../utils/clipboard';
import { useTranslation } from '../../i18n';
import type { TabContextMenuItem } from './TabContextMenu';

interface Options {
  /** Tab the context menu was opened on; `null` when no menu is open. */
  contextTab: TabState | null;
  tabs: TabState[];
  closeTab: (tabId: string) => Promise<boolean>;
  saveFileAs: (tabId: string, path: string) => Promise<unknown>;
  onRename: (tabId: string) => void;
}

/** Builds the tab right-click menu entries (built lazily: empty while the menu is closed). */
export function useTabContextMenuItems({
  contextTab,
  tabs,
  closeTab,
  saveFileAs,
  onRename,
}: Options): TabContextMenuItem[] {
  const t = useTranslation();
  if (!contextTab) return [];

  const tabId = contextTab.id;
  const path = contextTab.fileInfo.path;
  const hasPath = !!path;
  const otherCount = tabs.length - 1;

  const closeTabsSequentially = async (tabIds: string[]) => {
    for (const id of tabIds) {
      const closed = await closeTab(id);
      if (!closed) break;
    }
  };

  const handleSaveAs = async () => {
    try {
      const savePath = await save({ defaultPath: getTabSaveDefaultPath(contextTab) });
      if (savePath) await saveFileAs(tabId, savePath);
    } catch (err) {
      console.error('[TabBar] save-as failed:', err);
    }
  };

  return [
    { label: t('tabs.saveAs'), onClick: () => { void handleSaveAs(); } },
    { label: t('tabs.rename'), onClick: () => onRename(tabId) },
    {
      label: t('tabs.copyPath'),
      disabled: !hasPath,
      onClick: () => { if (path) void writeClipboardText(path); },
    },
    {
      label: t('tabs.copyFileName'),
      disabled: !hasPath,
      onClick: () => { if (path) void writeClipboardText(getBaseName(path)); },
    },
    { label: 'sep', separator: true },
    {
      label: t('tabs.closeAll'),
      disabled: tabs.length === 0,
      onClick: () => { closeTabsSequentially(tabs.map((tab) => tab.id)).catch(console.error); },
    },
    {
      label: t('tabs.closeOthers'),
      disabled: otherCount === 0,
      onClick: () => {
        closeTabsSequentially(tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)).catch(console.error);
      },
    },
  ];
}
