import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ChevronDown, X } from 'lucide-react';
import type { TabState } from '../../types';
import { getTabFileName, getTabTitle } from '../../utils/tabFileName';
import { tabNavigationTickAtom } from '../../store/tabNavigation';
import { useTranslation } from '../../i18n';
import styles from './TabListDropdown.module.css';

interface Props {
  tabs: TabState[];
  activeTabId: string | null;
  /** The tab strip is wider than its viewport; the dropdown is only useful then. */
  overflowing: boolean;
  onSelectTab: (tab: TabState) => void;
  /** Resolves true when the tab was actually closed (false if the user cancelled). */
  onCloseTab: (tabId: string) => Promise<boolean>;
  /** Move keyboard focus back to the active tab's editor (used after the panel closes). */
  onRestoreFocus: () => void;
}

interface PanelPos {
  top: number;
  right: number;
}

export const TabListDropdown: React.FC<Props> = ({
  tabs,
  activeTabId,
  overflowing,
  onSelectTab,
  onCloseTab,
  onRestoreFocus,
}) => {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pos, setPos] = useState<PanelPos>({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dismiss when the user navigates tabs by keyboard while the panel is open.
  const navTick = useAtomValue(tabNavigationTickAtom);
  const [prevNavTick, setPrevNavTick] = useState(navTick);
  if (prevNavTick !== navTick) {
    setPrevNavTick(navTick);
    if (open) setOpen(false);
  }

  // No overflow (or nothing to list) -> nothing to show; also resets stale open state.
  if (open && (!overflowing || tabs.length === 0)) setOpen(false);

  // Cheap O(tab count) metadata filter; never touches document content.
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? tabs.filter((tab) =>
        getTabFileName(tab, t).toLowerCase().includes(needle)
        || (tab.fileInfo.path ?? '').toLowerCase().includes(needle))
    : tabs;
  const selected = Math.max(0, Math.min(selectedIndex, filtered.length - 1));

  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 2, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setQuery('');
    setSelectedIndex(Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId)));
    setOpen(true);
  }, [open, tabs, activeTabId]);

  // Focus the search box when opened.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // When the panel closes and focus was lost (search input unmounted -> body) or is
  // parked on the trigger button, hand focus back to the editor so typing can continue.
  // Closing by clicking another focusable element (e.g. a different input) is left alone.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const active = document.activeElement;
      if (!active || active === document.body || active === triggerRef.current) {
        onRestoreFocus();
      }
    }
    wasOpenRef.current = open;
  }, [open, onRestoreFocus]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Keep the highlighted row visible while navigating with the keyboard.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, filtered.length]);

  const selectTab = useCallback((tab: TabState) => {
    setOpen(false);
    onSelectTab(tab);
  }, [onSelectTab]);

  const closeTabFromList = useCallback(async (tab: TabState) => {
    // A save-confirm modal will appear for unsaved tabs: get out of its way first.
    if (tab.fileInfo.is_modified) setOpen(false);
    try {
      await onCloseTab(tab.id);
    } catch (err) {
      console.error('[TabListDropdown] close tab failed:', err);
    }
    inputRef.current?.focus();
  }, [onCloseTab]);

  // Bound on the whole panel so keys keep working even if the input lost focus.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(filtered.length ? (selected + 1) % filtered.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(filtered.length ? (selected - 1 + filtered.length) % filtered.length : 0);
    } else if (e.key === 'Enter') {
      // Only from the search box: Enter on a focused close button must not select a tab.
      if (e.target !== inputRef.current) return;
      e.preventDefault();
      const tab = filtered[selected];
      if (tab) selectTab(tab);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }, [filtered, selected, selectTab]);

  // Clicking panel chrome / list / scrollbar must not pull focus out of the search box.
  const handlePanelMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== inputRef.current) e.preventDefault();
  }, []);

  if (!overflowing || tabs.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={handleToggle}
        title={t('tabs.list')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <ChevronDown size={15} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className={styles.panel}
          style={{ top: pos.top, right: pos.right }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={handleKeyDown}
          onMouseDown={handlePanelMouseDown}
        >
          <input
            ref={inputRef}
            className={styles.search}
            value={query}
            placeholder={t('tabs.listSearchPlaceholder')}
            spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          />
          <div className={styles.list} role="listbox">
            {filtered.length === 0 && <div className={styles.empty}>{t('tabs.listEmpty')}</div>}
            {filtered.map((tab, i) => (
              <div
                key={tab.id}
                data-index={i}
                role="option"
                aria-selected={tab.id === activeTabId}
                className={[
                  styles.item,
                  i === selected ? styles.itemSelected : '',
                  tab.id === activeTabId ? styles.itemActive : '',
                ].join(' ')}
                title={getTabTitle(tab, t)}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => selectTab(tab)}
              >
                {tab.fileInfo.is_modified && <span className={styles.dot}>●</span>}
                <span className={styles.name}>{getTabFileName(tab, t)}</span>
                {Boolean(tab.readOnly || tab.fileInfo.is_read_only) && (
                  <span className={styles.readOnly}>[{t('common.readOnly')}]</span>
                )}
                <span className={styles.path}>{tab.fileInfo.path ?? ''}</span>
                <button
                  type="button"
                  className={styles.close}
                  title={t('tabs.close')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTabFromList(tab);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
