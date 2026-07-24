import React from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { externalChangeTabIdAtom, tabsAtom } from '../../store/atoms';
import { getTabFileName } from '../../utils/tabFileName';
import { clearTextEdited, reloadFromStart } from '../../store/editorViewRegistry';
import * as cmd from '../../store/tauriCommands';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

/**
 * Shown when a file that has unsaved local edits is modified on disk by an
 * external process.  The user can choose to reload (discarding local changes)
 * or keep editing (ignoring the disk change).
 */
export const ExternalChangeDialog: React.FC = () => {
  const [externalChangeTabId, setExternalChangeTabId] = useAtom(externalChangeTabIdAtom);
  const tabs = useAtomValue(tabsAtom);
  const setTabs = useSetAtom(tabsAtom);
  const t = useTranslation();

  if (!externalChangeTabId) return null;

  const tab = tabs.find((t) => t.id === externalChangeTabId);
  if (!tab) {
    setExternalChangeTabId(null);
    return null;
  }

  const fileName = getTabFileName(tab, t);

  const handleReload = async () => {
    const tabId = externalChangeTabId;
    const bufferId = tab.bufferId;
    setExternalChangeTabId(null);
    try {
      const newInfo = await cmd.reloadBuffer(bufferId);
      clearTextEdited(bufferId);
      // Reset virtual-window to line 0 so the user sees the full new content.
      await reloadFromStart(bufferId);
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, fileInfo: newInfo } : t)),
      );
    } catch (err) {
      console.error('[ExternalChangeDialog] reload failed:', err);
    }
  };

  const handleKeep = () => {
    setExternalChangeTabId(null);
  };

  return (
    <div className={styles.overlay} onClick={handleKeep}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>
          {t('external.message', { fileName })}
        </p>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleReload}>
            {t('external.reload')}
          </button>
          <button className={styles.btnSecondary} onClick={handleKeep}>
            {t('external.keepLocal')}
          </button>
        </div>
      </div>
    </div>
  );
};
