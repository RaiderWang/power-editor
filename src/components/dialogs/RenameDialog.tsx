import React, { useEffect, useRef, useState } from 'react';
import type { TabState } from '../../types';
import { getTabFileName, getUntitledName, validateFileName } from '../../utils/tabFileName';
import { useTranslation } from '../../i18n';
import styles from './RenameDialog.module.css';

interface Props {
  tab: TabState;
  onConfirm: (newFileName: string) => Promise<void>;
  onClose: () => void;
}

export const RenameDialog: React.FC<Props> = ({ tab, onConfirm, onClose }) => {
  const t = useTranslation();
  const initialName = getTabFileName(tab, t);
  const isUntitled = initialName === getUntitledName(t);
  const [name, setName] = useState(isUntitled ? '' : initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = async () => {
    const validationError = validateFileName(name, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    const trimmed = name.trim();
    if (trimmed === initialName || (isUntitled && trimmed === '')) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit().catch(console.error);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>{t('rename.title')}</div>
        <div className={styles.body}>
          <label className={styles.label} htmlFor="rename-input">
            {t('rename.label')}
          </label>
          <input
            id="rename-input"
            ref={inputRef}
            className={styles.input}
            type="text"
            value={name}
            placeholder="untitled.txt"
            disabled={submitting}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
          />
          {error && <p className={styles.error}>{error}</p>}
          {!tab.fileInfo.path && (
            <p className={styles.hint}>{t('rename.hint')}</p>
          )}
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} disabled={submitting} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={styles.btnPrimary} disabled={submitting} onClick={() => handleSubmit().catch(console.error)}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
};
