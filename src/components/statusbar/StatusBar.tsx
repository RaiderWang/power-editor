import React, { useCallback, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { activeTabAtom, openProgressAtom, supportedEncodingsAtom } from '../../store/atoms';
import { getTabTitle } from '../../utils/tabFileName';
import { useFile } from '../../hooks/useFile';
import { EncodingPicker } from './EncodingPicker';
import { useTranslation } from '../../i18n';
import { formatBytes } from '../../utils/formatBytes';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  cursorLine: number;
  cursorCol: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({ cursorLine, cursorCol }) => {
  const activeTab = useAtomValue(activeTabAtom);
  const encodings = useAtomValue(supportedEncodingsAtom);
  const openProgress = useAtomValue(openProgressAtom);
  const { reopenWithEncoding } = useFile();
  const [pickerOpen, setPickerOpen] = useState(false);
  const encodingRef = useRef<HTMLButtonElement>(null);
  const t = useTranslation();

  const canReopen = Boolean(activeTab?.fileInfo.path);

  const handleEncodingClick = useCallback(() => {
    if (!activeTab || !activeTab.fileInfo.path) return;
    setPickerOpen(true);
  }, [activeTab]);

  const handleSelectEncoding = useCallback(async (enc: string) => {
    if (!activeTab || !activeTab.fileInfo.path) return;
    try {
      await reopenWithEncoding(activeTab.id, enc);
    } catch (err) {
      console.error('[StatusBar] reopenWithEncoding failed:', err);
    }
  }, [activeTab, reopenWithEncoding]);

  if (!activeTab) {
    return <div className={styles.bar} />;
  }

  const { fileInfo } = activeTab;

  return (
    <div className={styles.bar}>
      <span className={styles.item} title={t('status.cursorPos')}>
        {t('status.line', { line: cursorLine + 1, col: cursorCol + 1 })}
      </span>
      <span className={styles.separator}>|</span>
      <span className={styles.item} title={t('status.totalLines')}>
        {t('status.totalLinesValue', { count: fileInfo.total_lines.toLocaleString() })}
      </span>
      <span className={styles.separator}>|</span>
      <span className={styles.item} title={t('status.fileSize')}>
        {formatBytes(fileInfo.total_bytes)}
      </span>
      <span className={styles.separator}>|</span>
      <button
        type="button"
        ref={encodingRef}
        className={`${styles.encodingBtn} ${pickerOpen ? styles.encodingBtnActive : ''}`}
        title={canReopen ? t('status.encodingHint') : t('status.encodingDisabledHint')}
        disabled={!canReopen}
        onClick={canReopen ? handleEncodingClick : undefined}
      >
        <span>{t('status.openAs', { enc: fileInfo.encoding })}</span>
        <span className={styles.arrow} aria-hidden="true">▾</span>
      </button>
      <span className={styles.separator}>|</span>
      <span className={styles.item} title={t('status.lineEnding')}>{fileInfo.line_ending}</span>
      {!fileInfo.is_fully_loaded && (
        <>
          <span className={styles.separator}>|</span>
          <span className={`${styles.item} ${styles.loading}`}>
            {openProgress && openProgress.totalBytes > 0
              ? `${t('status.loading')} ${((openProgress.bytesRead / openProgress.totalBytes) * 100).toFixed(0)}% (${formatBytes(openProgress.bytesRead)} / ${formatBytes(openProgress.totalBytes)})`
              : t('status.loading')}
          </span>
        </>
      )}
      {fileInfo.is_modified && (
        <>
          <span className={styles.separator}>|</span>
          <span className={`${styles.item} ${styles.modified}`}>{t('status.modified')}</span>
        </>
      )}
      <span className={styles.spacer} />
      <span className={styles.item} title={t('status.filePath')}>
        {getTabTitle(activeTab, t)}
      </span>

      {pickerOpen && encodingRef.current && (
        <EncodingPicker
          currentEncoding={fileInfo.encoding}
          encodings={encodings}
          anchorEl={encodingRef.current}
          onSelect={handleSelectEncoding}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
};
