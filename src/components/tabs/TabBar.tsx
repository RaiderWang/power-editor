import React, { useCallback, useMemo, useState } from 'react';
import { getDefaultStore, useAtom } from 'jotai';
import { save } from '@tauri-apps/plugin-dialog';
import { tabsAtom, activeTabIdAtom, pendingCloseTabIdAtom } from '../../store/atoms';
import { splitLayoutAtom, secondaryActiveTabIdAtom, type PaneId } from '../../store/splitAtoms';
import { useFile } from '../../hooks/useFile';
import { getTabFileName, getTabSaveDefaultPath, getTabTitle } from '../../utils/tabFileName';
import { RenameDialog } from '../dialogs/RenameDialog';
import { TabContextMenu, type TabContextMenuItem } from './TabContextMenu';
import { useTranslation } from '../../i18n';
import styles from './TabBar.module.css';

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

interface TabBarProps {
  /** Which pane this TabBar belongs to. Defaults to 'primary' (standalone mode). */
  paneId?: PaneId;
  /** Controlled active tab id (used in split mode). */
  activeTabId?: string | null;
  /** Setter for the active tab (used in split mode). */
  onSetActiveTabId?: (id: string) => void;
  /** Called when the user clicks the "close split" button (secondary pane only). */
  onCloseSplit?: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  paneId = 'primary',
  activeTabId: controlledActiveTabId,
  onSetActiveTabId,
  onCloseSplit,
}) => {
  const [tabs] = useAtom(tabsAtom);
  const [internalActiveTabId, setInternalActiveTabId] = useAtom(activeTabIdAtom);
  const { closeTab, saveFileAs, renameFile, newFile } = useFile();
  const t = useTranslation();
  const [splitLayout, setSplitLayout] = useAtom(splitLayoutAtom);
  const [, setSecondaryActiveTabId] = useAtom(secondaryActiveTabIdAtom);

  // In split mode the parent passes controlled values; in standalone mode use
  // the internal atom directly.
  const isControlled = controlledActiveTabId !== undefined;
  const activeTabId = isControlled ? controlledActiveTabId : internalActiveTabId;
  const setActiveTabId = useCallback((id: string) => {
    if (isControlled && onSetActiveTabId) {
      onSetActiveTabId(id);
    } else {
      setInternalActiveTabId(id);
    }
  }, [isControlled, onSetActiveTabId, setInternalActiveTabId]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);

  const contextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;
  const renameTab = renameTabId ? tabs.find((t) => t.id === renameTabId) : null;

  const closeTabsSequentially = useCallback(async (tabIds: string[]) => {
    for (const id of tabIds) {
      await closeTab(id);
      if (getDefaultStore().get(pendingCloseTabIdAtom)) break;
    }
  }, [closeTab]);

  const handleSaveAs = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      const savePath = await save({ defaultPath: getTabSaveDefaultPath(tab) });
      if (savePath) await saveFileAs(tabId, savePath);
    } catch (err) {
      console.error('[TabBar] save-as failed:', err);
    }
  }, [tabs, saveFileAs]);

  const handleCopyFilePath = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    const path = tab?.fileInfo.path;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('[TabBar] copy file path failed:', err);
    }
  }, [tabs]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveTabId(tabId);
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, [setActiveTabId]);

  const menuItems: TabContextMenuItem[] = useMemo(() => {
    if (!contextTab) return [];
    const tabId = contextTab.id;
    const hasPath = !!contextTab.fileInfo.path;
    const otherCount = tabs.filter((t) => t.id !== tabId).length;

    return [
      { label: t('tabs.saveAs'), onClick: () => { handleSaveAs(tabId).catch(console.error); } },
      { label: t('tabs.rename'), onClick: () => setRenameTabId(tabId) },
      {
        label: t('tabs.copyPath'),
        disabled: !hasPath,
        onClick: () => { handleCopyFilePath(tabId).catch(console.error); },
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
  }, [contextTab, tabs, handleSaveAs, handleCopyFilePath, closeTabsSequentially, t]);

  const handleSplitToggle = useCallback(() => {
    if (splitLayout !== 'none') {
      // Close split
      setSplitLayout('none');
      setSecondaryActiveTabId(null);
    } else {
      // Open split: mirror current active tab in secondary pane
      setSecondaryActiveTabId(activeTabId ?? null);
      setSplitLayout('horizontal');
    }
  }, [splitLayout, setSplitLayout, activeTabId, setSecondaryActiveTabId]);

  if (tabs.length === 0) return null;

  return (
    <>
      <div
        className={styles.tabBar}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className={styles.tabList}>
          {tabs.map((tab) => {
            const fileName = getTabFileName(tab, t);
            const modified = tab.fileInfo.is_modified;
            const active = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                className={`${styles.tab} ${active ? styles.active : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                title={getTabTitle(tab, t)}
              >
                <span className={styles.title}>
                  {modified && <span className={styles.dot}>●</span>}
                  {fileName}
                </span>
                <button
                  className={styles.close}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title={t('tabs.close')}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            className={styles.newTabBtn}
            onClick={() => newFile().catch(console.error)}
            title={t('tabs.newTab')}
          >
            +
          </button>
        </div>

        <div className={styles.actions}>
          {paneId === 'secondary' && onCloseSplit ? (
            <button
              className={styles.actionBtn}
              onClick={onCloseSplit}
              title={t('tabs.closeSplit')}
            >
              ✕
            </button>
          ) : (
            <button
              className={`${styles.actionBtn} ${splitLayout !== 'none' ? styles.actionBtnActive : ''}`}
              onClick={handleSplitToggle}
              title={splitLayout !== 'none' ? t('tabs.closeSplit') : t('tabs.splitView')}
            >
              ⧉
            </button>
          )}
        </div>
      </div>

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {renameTab && (
        <RenameDialog
          tab={renameTab}
          onConfirm={async (newFileName) => {
            await renameFile(renameTab.id, newFileName);
          }}
          onClose={() => setRenameTabId(null)}
        />
      )}
    </>
  );
};
