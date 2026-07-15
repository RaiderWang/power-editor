import React, { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { v4 as uuidv4 } from 'uuid';
import type { TabState } from '../../types';
import { tabsAtom, activeTabIdAtom } from '../../store/atoms';
import * as cmd from '../../store/tauriCommands';
import { getTabFileName } from '../../utils/tabFileName';
import { useTranslation } from '../../i18n';
import styles from './CsvToFixedWidthDialog.module.css';

interface Props {
  tab: TabState;
  onClose: () => void;
}

export const CsvToFixedWidthDialog: React.FC<Props> = ({ tab, onClose }) => {
  const [delimiter, setDelimiter] = useState(',');
  const [fieldWidths, setFieldWidths] = useState('');
  const [ignoreSingleQuotes, setIgnoreSingleQuotes] = useState(true);
  const [ignoreDoubleQuotes, setIgnoreDoubleQuotes] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const delimiterRef = useRef<HTMLInputElement>(null);
  const t = useTranslation();

  const setTabs = useSetAtom(tabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);

  useEffect(() => {
    delimiterRef.current?.focus();
  }, []);

  const handleDetect = async () => {
    setDetecting(true);
    setError(null);
    try {
      const result = await cmd.csvDetect(tab.bufferId, 200);
      setDelimiter(result.delimiter === '\t' ? '\\t' : result.delimiter);
      setFieldWidths(result.field_widths.join(','));
    } catch (err) {
      setError(String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleConvert = async () => {
    const actualDelimiter = delimiter === '\\t' ? '\t' : delimiter;
    if (!actualDelimiter) {
      setError(t('csv.delimiterEmpty'));
      return;
    }
    const widths = fieldWidths
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (widths.length === 0) {
      setError(t('csv.invalidWidths'));
      return;
    }

    setConverting(true);
    setError(null);
    try {
      const fileInfo = await cmd.csvToFixedWidth(tab.bufferId, {
        delimiter: actualDelimiter,
        fieldWidths: widths,
        ignoreSingleQuotes,
        ignoreDoubleQuotes,
      });

      const originalName = getTabFileName(tab, t);
      const baseName = originalName.replace(/\.[^.]+$/, '');
      const newTab: TabState = {
        id: uuidv4(),
        bufferId: fileInfo.id,
        fileInfo,
        untitledName: `${baseName}_fixed.txt`,
        cursorLine: 0,
        cursorCol: 0,
        scrollTop: 0,
        language: 'txt',
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setConverting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const busy = detecting || converting;

  return (
    <div className={styles.overlay} onClick={onClose} onKeyDown={handleKeyDown}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>{t('csv.title')}</div>

        <div className={styles.body}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>{t('csv.quoteSection')}</span>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={ignoreSingleQuotes}
                disabled={busy}
                onChange={(e) => setIgnoreSingleQuotes(e.target.checked)}
              />
              {t('csv.ignoreSingle')}
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={ignoreDoubleQuotes}
                disabled={busy}
                onChange={(e) => setIgnoreDoubleQuotes(e.target.checked)}
              />
              {t('csv.ignoreDouble')}
            </label>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="csv-delimiter">
              {t('csv.delimiter')}
            </label>
            <input
              id="csv-delimiter"
              ref={delimiterRef}
              className={styles.input}
              type="text"
              value={delimiter}
              disabled={busy}
              placeholder={t('csv.delimiterPlaceholder')}
              onChange={(e) => { setDelimiter(e.target.value); setError(null); }}
            />
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="csv-widths">
              {t('csv.fieldWidths')}
            </label>
            <div className={styles.inputWithButton}>
              <input
                id="csv-widths"
                className={styles.input}
                type="text"
                value={fieldWidths}
                disabled={busy}
                placeholder={t('csv.fieldWidthsPlaceholder')}
                onChange={(e) => { setFieldWidths(e.target.value); setError(null); }}
              />
              <button
                className={styles.btnDetect}
                disabled={busy}
                onClick={() => { handleDetect().catch(console.error); }}
                title={t('csv.detectTitle')}
              >
                {detecting ? t('csv.detecting') : t('csv.autoDetect')}
              </button>
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.actions}>
          <button className={styles.btnSecondary} disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className={styles.btnPrimary}
            disabled={busy || !fieldWidths.trim()}
            onClick={() => { handleConvert().catch(console.error); }}
          >
            {converting ? t('csv.converting') : t('csv.convert')}
          </button>
        </div>
      </div>
    </div>
  );
};
