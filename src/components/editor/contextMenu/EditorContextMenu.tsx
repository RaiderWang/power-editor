import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import type { TabState } from '../../../types';
import type { EditorContextMenuItem, ContextMenuPosition } from './types';
import { useEditorContextMenuItems } from './useEditorContextMenuItems';
import styles from './EditorContextMenu.module.css';

interface EditorContextMenuProps {
  position: ContextMenuPosition;
  view: EditorView;
  tab: TabState;
  onSelectAll: () => void;
  onClose: () => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  position,
  view,
  tab,
  onSelectAll,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: position.x, top: position.y });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const items = useEditorContextMenuItems({
    view,
    tab,
    onSelectAll,
  });

  // Filter selectable items for keyboard navigation
  const selectableIndices = useMemo(() => {
    const list: number[] = [];
    items.forEach((item, index) => {
      if (!item.separator && !item.disabled) {
        list.push(index);
      }
    });
    return list;
  }, [items]);

  // Adjust menu coordinates to stay within window viewport
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    let left = position.x;
    let top = position.y;

    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }

    // Bail out when unchanged so this layout effect can never self-trigger a render loop.
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [position, items.length]);

  const executeItem = useCallback((item: EditorContextMenuItem) => {
    if (item.disabled || item.separator || !item.onClick) return;
    item.onClick();
    onClose();
    if (!item.keepFocus) view.focus();
  }, [onClose, view]);

  // Keyboard navigation & global close listeners
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Registered in the capture phase so the menu sees keys before CodeMirror;
    // handled keys are swallowed so the editor does not act on them as well.
    const swallow = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      if (e.key === 'Escape') {
        swallow(e);
        onClose();
        view.focus();
        return;
      }

      const isNavKey = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter';
      if (!isNavKey) {
        // Any other key: close so the menu never shows stale state. The key itself
        // still reaches the editor / shortcut dispatcher.
        onClose();
        return;
      }

      if (selectableIndices.length === 0) {
        swallow(e);
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        swallow(e);
        setFocusedIndex((prev) => {
          if (prev === null) return selectableIndices[0];
          const currPos = selectableIndices.indexOf(prev);
          const nextPos = (currPos + 1) % selectableIndices.length;
          return selectableIndices[nextPos];
        });
      } else if (e.key === 'ArrowUp') {
        swallow(e);
        setFocusedIndex((prev) => {
          if (prev === null) return selectableIndices[selectableIndices.length - 1];
          const currPos = selectableIndices.indexOf(prev);
          const nextPos = (currPos - 1 + selectableIndices.length) % selectableIndices.length;
          return selectableIndices[nextPos];
        });
      } else {
        // Enter
        swallow(e);
        const item = focusedIndex !== null ? items[focusedIndex] : undefined;
        if (item && !item.disabled && !item.separator) {
          executeItem(item);
        } else {
          onClose();
        }
      }
    };

    const onWindowChange = () => {
      onClose();
    };

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('blur', onWindowChange);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('blur', onWindowChange);
    };
  }, [onClose, selectableIndices, focusedIndex, items, executeItem, view]);

  const portalContainer = document.querySelector('.app') ?? document.body;

  const content = (
    <div
      className={styles.overlay}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        role="menu"
      >
        {items.map((item, idx) => {
          if (item.separator) {
            return <div key={`sep-${idx}`} className={styles.separator} role="separator" />;
          }

          const isFocused = focusedIndex === idx;

          return (
            <button
              key={item.id ?? `item-${idx}`}
              type="button"
              className={`${styles.item} ${isFocused ? styles.focused : ''}`}
              disabled={item.disabled}
              role="menuitem"
              onMouseEnter={() => setFocusedIndex(idx)}
              onClick={() => executeItem(item)}
            >
              <div className={styles.itemLeft}>
                <span className={styles.checkSlot}>
                  {item.checked ? '✓' : ''}
                </span>
                <span>{item.label}</span>
              </div>
              {item.shortcut && (
                <span className={styles.shortcut}>{item.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(content, portalContainer);
};
