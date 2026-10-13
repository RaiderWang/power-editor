import React, { useState, useEffect, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { pendingLargeFileAtom, editorPrefsAtom } from '../../store/atoms';
import type { PendingLargeFile } from '../../store/atoms';
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

const LargeFileConfirmModal: React.FC<{ pending: PendingLargeFile }> = ({ pending }) => {
  const setPending = useSetAtom(pendingLargeFileAtom);
  const setPrefs = useSetAtom(editorPrefsAtom);
  const t = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleContinue = useCallback(() => {
    if (dontAskAgain) {
      setPrefs((p) => ({ ...p, warnOnLargeFile: false }));
    }
    pending.resolve();
    setPending(null);
  }, [pending, dontAskAgain, setPrefs, setPending]);

  const handleCancel = useCallback(() => {
    pending.reject();
    setPending(null);
  }, [pending, setPending]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleContinue();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCancel, handleContinue]);

  const fileName = pending.path.split(/[\\/]/).pop() ?? pending.path;

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>
          {t('largeFile.confirmMessage', { fileName, size: formatSize(pending.sizeBytes) })}
        </p>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          <span>{t('largeFile.dontAskAgain')}</span>
        </label>
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

export const LargeFileConfirmDialog: React.FC = () => {
  const [pending] = useAtom(pendingLargeFileAtom);
  if (!pending) return null;
  return <LargeFileConfirmModal key={pending.path} pending={pending} />;
};
