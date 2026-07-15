import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { pendingCloseTabIdAtom, tabsAtom } from '../../store/atoms';
import { useFile } from '../../hooks/useFile';
import { getTabFileName, getTabSaveDefaultPath } from '../../utils/tabFileName';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

export const CloseConfirmDialog: React.FC = () => {
  const [pendingTabId, setPendingTabId] = useAtom(pendingCloseTabIdAtom);
  const tabs = useAtomValue(tabsAtom);
  const { saveFile, saveFileAs, forceCloseTab } = useFile();
  const t = useTranslation();

  if (!pendingTabId) return null;

  const tab = tabs.find((t) => t.id === pendingTabId);
  if (!tab) {
    setPendingTabId(null);
    return null;
  }

  const fileName = getTabFileName(tab, t);

  const handleSaveAndClose = async () => {
    setPendingTabId(null);
    if (tab.fileInfo.path) {
      await saveFile(pendingTabId);
    } else {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ title: t('close.saveAs'), defaultPath: getTabSaveDefaultPath(tab) });
      if (!path) return;
      await saveFileAs(pendingTabId, path);
    }
    await forceCloseTab(pendingTabId);
  };

  const handleDiscard = async () => {
    setPendingTabId(null);
    await forceCloseTab(pendingTabId);
  };

  const handleCancel = () => {
    setPendingTabId(null);
  };

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>
          {t('close.message', { fileName })}
        </p>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleSaveAndClose}>
            {t('close.saveAndClose')}
          </button>
          <button className={styles.btnDanger} onClick={handleDiscard}>
            {t('close.discard')}
          </button>
          <button className={styles.btnSecondary} onClick={handleCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
