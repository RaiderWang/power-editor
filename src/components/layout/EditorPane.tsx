import React, { useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { tabsAtom, activeTabIdAtom } from '../../store/atoms';
import {
  splitLayoutAtom,
  secondaryActiveTabIdAtom,
  activePaneAtom,
  type PaneId,
} from '../../store/splitAtoms';
import { TabBar } from '../tabs/TabBar';
import { Editor } from '../editor/Editor';
import styles from './EditorPane.module.css';

interface EditorPaneProps {
  paneId: PaneId;
  onCursorChange?: (line: number, col: number) => void;
}

export const EditorPane: React.FC<EditorPaneProps> = ({
  paneId,
  onCursorChange,
}) => {
  const tabs = useAtomValue(tabsAtom);
  const [primaryActiveTabId, setPrimaryActiveTabId] = useAtom(activeTabIdAtom);
  const [secondaryActiveTabId, setSecondaryActiveTabId] = useAtom(secondaryActiveTabIdAtom);
  const [, setSplitLayout] = useAtom(splitLayoutAtom);
  const [, setActivePane] = useAtom(activePaneAtom);

  const activeTabId = paneId === 'primary' ? primaryActiveTabId : secondaryActiveTabId;
  const setActiveTabId = paneId === 'primary' ? setPrimaryActiveTabId : setSecondaryActiveTabId;

  const handleCursorChange = useCallback((line: number, col: number) => {
    onCursorChange?.(line, col);
  }, [onCursorChange]);

  const handleCloseSplit = useCallback(() => {
    setSplitLayout('none');
    setSecondaryActiveTabId(null);
    setActivePane('primary');
  }, [setSplitLayout, setSecondaryActiveTabId, setActivePane]);

  const handleFocus = useCallback(() => {
    setActivePane(paneId);
  }, [paneId, setActivePane]);

  return (
    <div
      className={styles.pane}
      onMouseDown={handleFocus}
      onFocus={handleFocus}
    >
      <TabBar
        paneId={paneId}
        activeTabId={activeTabId}
        onSetActiveTabId={setActiveTabId}
        onCloseSplit={paneId === 'secondary' ? handleCloseSplit : undefined}
      />
      <div className={styles.editorArea}>
        {tabs.length === 0 ? (
          <div className={styles.empty} />
        ) : (
          tabs.map((tab) => (
            <div
              key={`${paneId}-${tab.id}`}
              style={{ display: tab.id === activeTabId ? 'contents' : 'none' }}
            >
              <Editor
                tab={tab}
                onCursorChange={handleCursorChange}
                paneId={paneId}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
