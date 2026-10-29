import React, { useCallback, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ArrowUpCircle } from 'lucide-react';
import { activeTabAtom, openProgressAtom, supportedEncodingsAtom } from '../../store/atoms';
import { updateStatusAtom, updateDetailsAtom, updateDialogOpenAtom } from '../../store/updaterAtoms';
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
  const updateStatus = useAtomValue(updateStatusAtom);
  const updateDetails = useAtomValue(updateDetailsAtom);
  const setUpdateDialogOpen = useSetAtom(updateDialogOpenAtom);
  const { reopenWithEncoding } = useFile();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Callback ref + state so the picker anchor can be read during render safely.
  const [encodingEl, setEncodingEl] = useState<HTMLButtonElement | null>(null);
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
    return (
      <div className={styles.bar}>
        <span className={styles.spacer} />
        {updateStatus === 'available' && updateDetails && (
          <button
            type="button"
            className={styles.updateBadge}
            onClick={() => setUpdateDialogOpen(true)}
            title={t('update.badgeHint', { version: updateDetails.version })}
          >
            <ArrowUpCircle size={12} />
            <span>v{updateDetails.version}</span>
          </button>
        )}
      </div>
    );
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
        ref={setEncodingEl}
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
      {Boolean(activeTab.readOnly || fileInfo.is_read_only) && (
        <>
          <span className={styles.separator}>|</span>
          <span className={styles.item} style={{ color: '#e5a50a', fontWeight: 500 }} title={t('status.readOnlyHint')}>
            🔒 {t('common.readOnly')}
          </span>
        </>
      )}
      <span className={styles.spacer} />

      {updateStatus === 'available' && updateDetails && (
        <>
          <button
            type="button"
            className={styles.updateBadge}
            onClick={() => setUpdateDialogOpen(true)}
            title={t('update.badgeHint', { version: updateDetails.version })}
          >
            <ArrowUpCircle size={12} />
            <span>v{updateDetails.version}</span>
          </button>
          <span className={styles.separator}>|</span>
        </>
      )}

      <span className={styles.item} title={t('status.filePath')}>
        {getTabTitle(activeTab, t)}
      </span>

      {pickerOpen && encodingEl && (
        <EncodingPicker
          currentEncoding={fileInfo.encoding}
          encodings={encodings}
          anchorEl={encodingEl}
          onSelect={handleSelectEncoding}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
};
