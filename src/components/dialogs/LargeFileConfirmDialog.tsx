import React from 'react';
import { useAtom } from 'jotai';
import { pendingLargeFileAtom } from '../../store/atoms';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

/** Format byte count as a human-readable string (e.g. "1.53 GB"). */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export const LargeFileConfirmDialog: React.FC = () => {
  const [pending, setPending] = useAtom(pendingLargeFileAtom);
  const t = useTranslation();

  if (!pending) return null;

  const fileName = pending.path.split(/[\\/]/).pop() ?? pending.path;

  const handleContinue = () => {
    pending.resolve();
    setPending(null);
  };

  const handleCancel = () => {
    pending.reject();
    setPending(null);
  };

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>
          {t('largeFile.confirmMessage', { fileName, size: formatSize(pending.sizeBytes) })}
        </p>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleContinue}>
            {t('largeFile.continue')}
          </button>
          <button className={styles.btnSecondary} onClick={handleCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
