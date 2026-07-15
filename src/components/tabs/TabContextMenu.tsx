import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './TabContextMenu.module.css';

export interface TabContextMenuItem {
  label: string;
  separator?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: TabContextMenuItem[];
  onClose: () => void;
}

export const TabContextMenu: React.FC<Props> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) {
      left = Math.max(0, window.innerWidth - rect.width);
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, window.innerHeight - rect.height);
    }
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
            <div key={`sep-${i}`} className={styles.separator} />
        ) : (
          <button
            key={item.label}
            type="button"
            className={styles.item}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled && item.onClick) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
};
