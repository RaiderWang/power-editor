import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n';
import styles from './EncodingPicker.module.css';

interface EncodingPickerProps {
  currentEncoding: string;
  encodings: string[];
  anchorEl?: HTMLElement | null;
  onSelect: (encoding: string) => void;
  onClose: () => void;
}

export const EncodingPicker: React.FC<EncodingPickerProps> = ({
  currentEncoding,
  encodings,
  anchorEl,
  onSelect,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useTranslation();

  // 定位：有锚点时出现在锚点正上方，无锚点时居中弹窗展示
  const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
  const style: React.CSSProperties = rect
    ? {
        position: 'fixed',
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
      }
    : {
        position: 'fixed',
        left: '50%',
        top: '20%',
        transform: 'translateX(-50%)',
        minWidth: 260,
      };

  // 点击面板外部时关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // 按 Esc 键关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {!anchorEl && <div className={styles.backdrop} onClick={onClose} />}
      <div ref={panelRef} className={styles.panel} style={style}>
      <div className={styles.header}>{t('encoding.reopenHeader')}</div>
      <div className={styles.list}>
        {encodings.map((enc) => (
          <button
            key={enc}
            className={`${styles.item} ${enc === currentEncoding ? styles.current : ''}`}
            onClick={() => { onSelect(enc); onClose(); }}
          >
            {enc}
            {enc === currentEncoding && <span className={styles.checkmark}>✓</span>}
          </button>
        ))}
      </div>
    </div>
    </>
  );
};
