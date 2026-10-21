import React, { useEffect } from 'react';
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

  const tab = tabs.find((t) => t.id === pendingTabId);

  // If the target tab was closed externally while the dialog was pending, clean up via effect
  useEffect(() => {
    if (pendingTabId && !tab) {
      setPendingTabId(null);
      pendingResolver?.(true);
      setPendingResolver(null);
    }
  }, [pendingTabId, tab, pendingResolver, setPendingTabId, setPendingResolver]);

  if (!pendingTabId || !tab) return null;

  const fileName = getTabFileName(tab, t);

  const handleSaveAndClose = async () => {
    const tabIdToClose = pendingTabId;
    const resolver = pendingResolver;
    setPendingTabId(null);
    setPendingResolver(null);

    try {
      const isReadOnly = Boolean(tab.readOnly || tab.fileInfo.is_read_only);
      if (tab.fileInfo.path && !isReadOnly) {
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
    } catch (err) {
      console.error('[CloseConfirmDialog] save before close failed:', err);
      resolver?.(false);
    }
  };

  const handleDiscard = async () => {
    const tabIdToClose = pendingTabId;
    const resolver = pendingResolver;
    setPendingTabId(null);
    setPendingResolver(null);
    try {
      await forceCloseTab(tabIdToClose);
      resolver?.(true);
    } catch (err) {
      console.error('[CloseConfirmDialog] discard failed:', err);
      resolver?.(false);
    }
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
