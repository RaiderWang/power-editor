import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n';
import styles from './HistoryComboInput.module.css';

interface HistoryComboInputProps {
  value: string;
  onChange: (value: string) => void;
  history: string[];
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  /** 每次递增时，输入框内容会全选。用于面板打开时自动选中预填文本。 */
  selectAllTrigger?: number;
}

export const HistoryComboInput: React.FC<HistoryComboInputProps> = ({
  value,
  onChange,
  history,
  placeholder,
  onKeyDown,
  autoFocus,
  selectAllTrigger,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslation();

  useEffect(() => {
    if (!selectAllTrigger) return;
    inputRef.current?.select();
  }, [selectAllTrigger]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={handleKeyDown}
      />
      {history.length > 0 && (
        <button
          className={styles.toggleBtn}
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((prev) => !prev);
          }}
          title={t('history.title')}
          aria-label={t('history.ariaLabel')}
        >
          ▾
        </button>
      )}
      {open && history.length > 0 && (
        <ul className={styles.dropdown} role="listbox">
          {history.map((item, i) => (
            <li
              key={i}
              className={styles.dropdownItem}
              role="option"
              aria-selected={item === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(item);
                setOpen(false);
              }}
              title={item}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
