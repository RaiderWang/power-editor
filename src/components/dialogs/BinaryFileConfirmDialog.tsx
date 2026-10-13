import React, { useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import { pendingBinaryFileAtom } from '../../store/atoms';
import { useTranslation } from '../../i18n';
import styles from './CloseConfirmDialog.module.css';

export const BinaryFileConfirmDialog: React.FC = () => {
  const [pending, setPending] = useAtom(pendingBinaryFileAtom);
  const t = useTranslation();

  const handleOpenReadOnly = useCallback(() => {
    if (pending) {
      pending.resolve(true);
      setPending(null);
    }
  }, [pending, setPending]);

  const handleCancel = useCallback(() => {
    if (pending) {
      pending.reject();
      setPending(null);
    }
  }, [pending, setPending]);

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleOpenReadOnly();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pending, handleCancel, handleOpenReadOnly]);

  if (!pending) return null;

  const fileName = pending.path.split(/[\\/]/).pop() ?? pending.path;

  return (
    <div className={styles.overlay} onClick={handleCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #e0e0e0)' }}>
          <span>⚠️</span>
          <span>{t('binaryFile.title')}</span>
        </div>
        <p className={styles.message}>
          {t('binaryFile.confirmMessage', { fileName })}
        </p>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleOpenReadOnly}>
            {t('binaryFile.openReadOnly')}
          </button>
          <button className={styles.btnSecondary} onClick={handleCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
