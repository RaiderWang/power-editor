import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { pendingCloseTabIdAtom, pendingCloseResolverAtom, tabsAtom } from '../../store/atoms';
import { useFile } from '../../hooks/useFile';
import { getTabFileName, getTabSaveDefaultPath } from '../../utils/tabFileName';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

export const CloseConfirmDialog: React.FC = () => {
  const [pendingTabId, setPendingTabId] = useAtom(pendingCloseTabIdAtom);
  const [pendingResolver, setPendingResolver] = useAtom(pendingCloseResolverAtom);
  const tabs = useAtomValue(tabsAtom);
  const { saveFile, saveFileAs, forceCloseTab } = useFile();
  const t = useTranslation();

  if (!pendingTabId) return null;

  const tab = tabs.find((t) => t.id === pendingTabId);
  if (!tab) {
    setPendingTabId(null);
    if (pendingResolver) {
      pendingResolver(true);
      setPendingResolver(null);
    }
    return null;
  }

  const fileName = getTabFileName(tab, t);

  const handleSaveAndClose = async () => {
    const tabIdToClose = pendingTabId;
    const resolver = pendingResolver;
    setPendingTabId(null);
    setPendingResolver(null);

    if (tab.fileInfo.path) {
      await saveFile(tabIdToClose);
    } else {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ title: t('close.saveAs'), defaultPath: getTabSaveDefaultPath(tab) });
      if (!path) {
        resolver?.(false);
        return;
      }
      await saveFileAs(tabIdToClose, path);
    }
    await forceCloseTab(tabIdToClose);
    resolver?.(true);
  };

  const handleDiscard = async () => {
    const tabIdToClose = pendingTabId;
    const resolver = pendingResolver;
    setPendingTabId(null);
    setPendingResolver(null);
    await forceCloseTab(tabIdToClose);
    resolver?.(true);
  };

  const handleCancel = () => {
    const resolver = pendingResolver;
    setPendingTabId(null);
    setPendingResolver(null);
    resolver?.(false);
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
