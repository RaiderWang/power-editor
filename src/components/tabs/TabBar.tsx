import React, { useCallback, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { SquareSplitHorizontal, X } from 'lucide-react';
import { tabsAtom, activeTabIdAtom } from '../../store/atoms';
import {
  splitLayoutAtom,
  secondaryModeAtom,
  openSplitAtom,
  closeSplitAtom,
  activePaneAtom,
  type PaneId,
} from '../../store/splitAtoms';
import { focusEditor } from '../../store/editorViewRegistry';
import { useFile } from '../../hooks/useFile';
import { useTabBarScroll } from '../../hooks/useTabBarScroll';
import { getTabFileName, getTabTitle } from '../../utils/tabFileName';
import { RenameDialog } from '../dialogs/RenameDialog';
import { TabContextMenu } from './TabContextMenu';
import { TabListDropdown } from './TabListDropdown';
import { useTabContextMenuItems } from './useTabContextMenuItems';
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
  const splitLayout = useAtomValue(splitLayoutAtom);
  const secondaryMode = useAtomValue(secondaryModeAtom);
  // A Markdown preview is not an editor split: only treat the editor split as "split view".
  const isEditorSplit = splitLayout !== 'none' && secondaryMode === 'editor';
  const openSplit = useSetAtom(openSplitAtom);
  const closeSplit = useSetAtom(closeSplitAtom);
  const setActivePane = useSetAtom(activePaneAtom);

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

  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const { overflowing, canScrollLeft, canScrollRight } = useTabBarScroll(
    listRef,
    innerRef,
    activeTabId,
    tabs.length,
  );
  const fadeClass = canScrollLeft && canScrollRight
    ? styles.fadeBoth
    : canScrollLeft
      ? styles.fadeLeft
      : canScrollRight
        ? styles.fadeRight
        : '';

  const handleTabClick = useCallback((tab: typeof tabs[number]) => {
    setActivePane(paneId);
    setActiveTabId(tab.id);
    focusEditor(tab.bufferId, paneId, { force: true });
  }, [paneId, setActivePane, setActiveTabId]);

  const restoreEditorFocus = useCallback(() => {
    const tab = tabs.find((x) => x.id === activeTabId);
    if (tab) focusEditor(tab.bufferId, paneId);
  }, [tabs, activeTabId, paneId]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);

  const contextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) ?? null : null;
  const renameTab = renameTabId ? tabs.find((t) => t.id === renameTabId) : null;

  const menuItems = useTabContextMenuItems({
    contextTab,
    tabs,
    closeTab,
    saveFileAs,
    onRename: setRenameTabId,
  });

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: typeof tabs[number]) => {
    e.preventDefault();
    e.stopPropagation();
    setActivePane(paneId);
    setActiveTabId(tab.id);
    setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
  }, [paneId, setActivePane, setActiveTabId]);

  const handleSplitToggle = useCallback(() => {
    if (isEditorSplit) {
      closeSplit();
    } else {
      openSplit('horizontal', 'editor');
    }
  }, [isEditorSplit, closeSplit, openSplit]);

  if (tabs.length === 0) return null;

  return (
    <>
      <div
        className={styles.tabBar}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={listRef} className={`${styles.tabList} ${fadeClass}`}>
          <div ref={innerRef} className={styles.tabListInner}>
            {tabs.map((tab) => {
              const fileName = getTabFileName(tab, t);
              const modified = tab.fileInfo.is_modified;
              const active = tab.id === activeTabId;

              return (
                <div
                  key={tab.id}
                  data-tab-id={tab.id}
                  className={`${styles.tab} ${active ? styles.active : ''}`}
                  onClick={() => handleTabClick(tab)}
                  onMouseDown={(e) => {
                    if (e.button === 0 && !(e.target as HTMLElement).closest(`.${styles.close}`)) {
                      handleTabClick(tab);
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, tab)}
                  title={getTabTitle(tab, t)}
                >
                  <span className={styles.title}>
                    {modified && <span className={styles.dot}>●</span>}
                    {fileName}
                    {Boolean(tab.readOnly || tab.fileInfo.is_read_only) && (
                      <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '4px' }}>[{t('common.readOnly')}]</span>
                    )}
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
          </div>
        </div>

        <button
          className={styles.newTabBtn}
          onClick={() => newFile().catch(console.error)}
          title={t('tabs.newTab')}
        >
          +
        </button>

        <div className={styles.actions}>
          <TabListDropdown
            tabs={tabs}
            activeTabId={activeTabId}
            overflowing={overflowing}
            onSelectTab={handleTabClick}
            onCloseTab={closeTab}
            onRestoreFocus={restoreEditorFocus}
          />
          {paneId === 'secondary' && onCloseSplit ? (
            <button
              className={styles.actionBtn}
              onClick={onCloseSplit}
              title={t('tabs.closeSplit')}
            >
              <X size={14} />
            </button>
          ) : (
            <button
              className={`${styles.actionBtn} ${isEditorSplit ? styles.actionBtnActive : ''}`}
              onClick={handleSplitToggle}
              title={isEditorSplit ? t('tabs.closeSplit') : t('tabs.splitView')}
            >
              <SquareSplitHorizontal size={15} />
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
