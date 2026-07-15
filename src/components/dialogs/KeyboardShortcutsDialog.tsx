import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import {
  DEFAULT_KEYBINDINGS,
  CATEGORIES,
  CATEGORY_LABEL_KEYS,
  customKeybindingsAtom,
  keybindingsDialogOpenAtom,
  getEffectiveShortcut,
  saveCustomKeybindings,
  eventToShortcut,
} from '../../store/keybindings';
import type { CustomKeybindings, KeybindingCategory } from '../../store/keybindings';
import { useTranslation } from '../../i18n';
import styles from './KeyboardShortcutsDialog.module.css';

export const KeyboardShortcutsDialog: React.FC = () => {
  const [open, setOpen] = useAtom(keybindingsDialogOpenAtom);
  const [customs, setCustoms] = useAtom(customKeybindingsAtom);
  const [filter, setFilter] = useState('');
  const t = useTranslation();
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    setCapturingId(null);
    setFilter('');
  }, [setOpen]);

  // Press Escape to close the dialog (only when not capturing)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !capturingId) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, capturingId, handleClose]);

  const filteredByCategory = useMemo(() => {
    const lower = filter.toLowerCase();
    const grouped = new Map<KeybindingCategory, typeof DEFAULT_KEYBINDINGS>();
    for (const cat of CATEGORIES) grouped.set(cat, []);
    for (const def of DEFAULT_KEYBINDINGS) {
      const label = t(def.labelKey).toLowerCase();
      if (lower && !label.includes(lower) && !def.id.toLowerCase().includes(lower)) {
        const shortcut = getEffectiveShortcut(def.id, customs);
        if (!shortcut.toLowerCase().includes(lower)) continue;
      }
      grouped.get(def.category)!.push(def);
    }
    return grouped;
  }, [filter, customs, t]);

  const hasResults = useMemo(() => {
    for (const items of filteredByCategory.values()) {
      if (items.length > 0) return true;
    }
    return false;
  }, [filteredByCategory]);

  const conflictMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const def of DEFAULT_KEYBINDINGS) {
      if (!def.editable) continue;
      const shortcut = getEffectiveShortcut(def.id, customs).toLowerCase();
      if (!shortcut) continue;
      if (!map.has(shortcut)) map.set(shortcut, []);
      map.get(shortcut)!.push(def.id);
    }
    const conflicts = new Map<string, string>();
    for (const [, ids] of map) {
      if (ids.length > 1) {
        for (const id of ids) {
          const otherId = ids.find((x) => x !== id);
          const otherDef = DEFAULT_KEYBINDINGS.find((d) => d.id === otherId);
          const otherLabel = otherDef ? t(otherDef.labelKey) : '';
          conflicts.set(id, t('keybinding.conflict', { label: otherLabel }));
        }
      }
    }
    return conflicts;
  }, [customs, t]);

  const handleStartCapture = useCallback((id: string) => {
    const def = DEFAULT_KEYBINDINGS.find((d) => d.id === id);
    if (!def?.editable) return;
    setCapturingId(id);
  }, []);

  const updateCustom = useCallback((id: string, shortcut: string) => {
    setCustoms((prev) => {
      const def = DEFAULT_KEYBINDINGS.find((d) => d.id === id);
      const next: CustomKeybindings = { ...prev };
      if (def && shortcut === def.defaultShortcut) {
        delete next[id];
      } else {
        next[id] = shortcut;
      }
      saveCustomKeybindings(next);
      return next;
    });
  }, [setCustoms]);

  const handleCapture = useCallback((e: KeyboardEvent) => {
    if (!capturingId) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setCapturingId(null);
      return;
    }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      updateCustom(capturingId, '');
      setCapturingId(null);
      return;
    }

    const shortcut = eventToShortcut(e);
    if (!shortcut) return;

    updateCustom(capturingId, shortcut);
    setCapturingId(null);
  }, [capturingId, updateCustom]);

  useEffect(() => {
    if (!capturingId) return;
    window.addEventListener('keydown', handleCapture, true);
    return () => window.removeEventListener('keydown', handleCapture, true);
  }, [capturingId, handleCapture]);

  const handleResetOne = useCallback((id: string) => {
    setCustoms((prev) => {
      const next = { ...prev };
      delete next[id];
      saveCustomKeybindings(next);
      return next;
    });
  }, [setCustoms]);

  const handleResetAll = useCallback(() => {
    setCustoms({});
    saveCustomKeybindings({});
  }, [setCustoms]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={handleClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>{t('keybinding.title')}</span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder={t('keybinding.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.body}>
          {!hasResults && (
            <div className={styles.noResults}>{t('keybinding.noResults')}</div>
          )}
          {CATEGORIES.map((cat) => {
            const items = filteredByCategory.get(cat)!;
            if (items.length === 0) return null;
            return (
              <div key={cat} className={styles.categoryGroup}>
                <div className={styles.categoryHeader}>{t(CATEGORY_LABEL_KEYS[cat])}</div>
                {items.map((def) => {
                  const shortcut = getEffectiveShortcut(def.id, customs);
                  const isModified = def.id in customs;
                  const isCapturing = capturingId === def.id;
                  const conflict = conflictMap.get(def.id);

                  return (
                    <div key={def.id} className={styles.row}>
                      <span className={`${styles.rowLabel} ${!def.editable ? styles.rowReadonly : ''}`}>
                        {t(def.labelKey)}
                      </span>
                      <div className={styles.shortcutCell}>
                        {conflict && <span className={styles.conflict}>{conflict}</span>}
                        <div
                          ref={isCapturing ? captureRef : undefined}
                          className={`
                            ${styles.shortcutBadge}
                            ${!def.editable ? styles.shortcutBadgeReadonly : ''}
                            ${isCapturing ? styles.capturing : ''}
                            ${isModified ? styles.modified : ''}
                          `}
                          onClick={() => def.editable && handleStartCapture(def.id)}
                          title={
                            !def.editable
                              ? t('keybinding.builtinHint')
                              : isCapturing
                                ? t('keybinding.captureHint')
                                : t('keybinding.clickHint')
                          }
                        >
                          {isCapturing
                            ? t('keybinding.capturing')
                            : shortcut || <span className={styles.shortcutEmpty}>{t('keybinding.unset')}</span>
                          }
                        </div>
                        {def.editable && isModified && !isCapturing && (
                          <button
                            className={styles.resetBtn}
                            onClick={() => handleResetOne(def.id)}
                            title={t('keybinding.resetDefault', { shortcut: def.defaultShortcut || '-' })}
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}>
            {t('keybinding.footerHint')}
          </span>
          <button className={styles.btnReset} onClick={handleResetAll}>{t('keybinding.resetAll')}</button>
          <button className={styles.btnClose} onClick={handleClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
};
