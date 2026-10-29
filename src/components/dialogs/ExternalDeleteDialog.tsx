import React, { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { externalDeletedTabIdsAtom, tabsAtom } from '../../store/atoms';
import { useFile } from '../../hooks/useFile';
import { getTabFileName, getTabSaveDefaultPath } from '../../utils/tabFileName';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

/**
 * Shown when the file behind a tab was deleted (or moved away) by another
 * program. The user can save the content as a new file, close the tab, or keep
 * the tab open (marked as modified) to inspect / copy the text first. There is
 * no implicit dismiss, so the overlay does not close on click.
 * Tabs are handled one at a time from the `externalDeletedTabIdsAtom` queue.
 */
export const ExternalDeleteDialog: React.FC = () => {
  const [queue, setQueue] = useAtom(externalDeletedTabIdsAtom);
  const [tabs, setTabs] = useAtom(tabsAtom);
  const { saveFileAs, forceCloseTab } = useFile();
  const t = useTranslation();
  const [busy, setBusy] = useState(false);

  const tabId = queue[0] ?? null;
  const tab = tabId ? tabs.find((x) => x.id === tabId) : undefined;

  // The tab disappeared (e.g. closed some other way): drop it from the queue.
  useEffect(() => {
    if (tabId && !tab) {
      setQueue((prev) => prev.filter((id) => id !== tabId));
    }
  }, [tabId, tab, setQueue]);

  if (!tabId || !tab) return null;

  const fileName = getTabFileName(tab, t);
  const dequeue = () => setQueue((prev) => prev.filter((id) => id !== tabId));

  const handleSaveAs = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { save, message } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ title: t('externalDelete.saveAs'), defaultPath: getTabSaveDefaultPath(tab) });
      // User cancelled the file picker: keep this dialog so they can still choose.
      if (!path) return;
      try {
        await saveFileAs(tabId, path);
        dequeue();
      } catch (err) {
        console.error('[ExternalDeleteDialog] save as failed:', err);
        await message(String(err), { title: t('externalDelete.saveFailed'), kind: 'error' });
      }
    } catch (err) {
      console.error('[ExternalDeleteDialog] save dialog failed:', err);
    } finally {
      setBusy(false);
    }
  };

  // Let the user look at / copy the content first. The content no longer exists
  // on disk, so mark the tab modified: closing it later goes through the normal
  // "save changes?" confirmation instead of silently losing the text.
  const handleKeep = () => {
    setTabs((prev) =>
      prev.map((x) => (x.id === tabId ? { ...x, fileInfo: { ...x.fileInfo, is_modified: true } } : x)),
    );
    dequeue();
  };

  const handleClose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await forceCloseTab(tabId);
      dequeue();
    } catch (err) {
      console.error('[ExternalDeleteDialog] close tab failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const messageKey = tab.fileInfo.is_modified ? 'externalDelete.messageModified' : 'externalDelete.message';

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>{t(messageKey, { fileName })}</p>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleSaveAs} disabled={busy}>
            {t('externalDelete.saveAs')}
          </button>
          <button className={styles.btnSecondary} onClick={handleKeep} disabled={busy}>
            {t('externalDelete.keep')}
          </button>
          <button className={styles.btnDanger} onClick={handleClose} disabled={busy}>
            {t('externalDelete.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
