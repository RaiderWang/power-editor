import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n';
import styles from './EncodingPicker.module.css';

interface EncodingPickerProps {
  currentEncoding: string;
  encodings: string[];
  anchorEl: HTMLElement;
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

  // 定位：面板出现在锚点元素的正上方
  const rect = anchorEl.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect.left,
    bottom: window.innerHeight - rect.top,
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

  return (
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
  );
};
