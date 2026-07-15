import React, { useCallback, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { activeTabAtom, supportedEncodingsAtom, tabsAtom } from '../../store/atoms';
import { getTabTitle } from '../../utils/tabFileName';
import * as cmd from '../../store/tauriCommands';
import { clearTextEdited } from '../../store/editorViewRegistry';
import { EncodingPicker } from './EncodingPicker';
import { useTranslation } from '../../i18n';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  cursorLine: number;
  cursorCol: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const StatusBar: React.FC<StatusBarProps> = ({ cursorLine, cursorCol }) => {
  const activeTab = useAtomValue(activeTabAtom);
  const encodings = useAtomValue(supportedEncodingsAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const encodingRef = useRef<HTMLSpanElement>(null);
  const t = useTranslation();

  const handleEncodingClick = useCallback(() => {
    if (!activeTab) return;
    setPickerOpen(true);
  }, [activeTab]);

  const handleSelectEncoding = useCallback(async (enc: string) => {
    if (!activeTab) return;
    if (enc === activeTab.fileInfo.encoding) return;
    try {
      // reopenWithEncoding closes the old buffer and returns a FileInfo with a new bufferId.
      // Updating bufferId triggers Editor's useEffect([tab.bufferId]) which re-registers
      // the CM view and calls loadContent automatically.
      const newInfo = await cmd.reopenWithEncoding(activeTab.bufferId, enc);
      clearTextEdited(activeTab.bufferId);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, bufferId: newInfo.id, fileInfo: newInfo } : t))
      );
    } catch (err) {
      console.error('[StatusBar] reopenWithEncoding failed:', err);
    }
  }, [activeTab, setTabs]);

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
      <span
        ref={encodingRef}
        className={`${styles.item} ${styles.clickable}`}
        title={t('status.encodingHint')}
        onClick={handleEncodingClick}
      >
        {fileInfo.encoding}
      </span>
      <span className={styles.separator}>|</span>
      <span className={styles.item} title={t('status.lineEnding')}>{fileInfo.line_ending}</span>
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
