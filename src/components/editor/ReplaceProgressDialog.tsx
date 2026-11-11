import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { replaceProgressAtom, restoreFocusIfLost } from '../../store/replaceProgress';
import type { ReplaceProgressInfo } from '../../store/replaceProgress';
import * as cmd from '../../store/tauriCommands';
import { formatBytes } from '../../utils/formatBytes';
import { useTranslation } from '../../i18n';
import styles from './ReplaceProgressDialog.module.css';

/**
 * Small jobs finish in a few milliseconds; showing the dialog right away would just
 * flash. The (transparent) overlay still blocks input immediately.
 */
const SHOW_DELAY_MS = 150;

const ReplaceProgressModal: React.FC<{ progress: ReplaceProgressInfo }> = ({ progress }) => {
  const t = useTranslation();
  const [, setProgress] = useAtom(replaceProgressAtom);
  const [visible, setVisible] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { bufferId } = progress;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // When the overlay goes away (cancelled / failed run), give focus back to where it
  // was so Escape etc. keep working. Passive cleanup runs after the DOM is removed, so
  // lost focus shows up as `document.body`.
  useEffect(() => () => restoreFocusIfLost(null), []);

  // Move focus off the (now hidden) search inputs / editor onto the Cancel button.
  useEffect(() => {
    if (visible) cancelRef.current?.focus();
  }, [visible]);

  const handleCancel = useCallback(async () => {
    setProgress((prev) => (prev ? { ...prev, cancelling: true } : prev));
    try {
      await cmd.cancelReplaceAll(bufferId);
    } catch (err) {
      console.error('[ReplaceProgressDialog] cancel failed:', err);
    }
  }, [bufferId, setProgress]);

  // While the job runs, swallow keyboard input so nothing can edit the text, switch
  // tabs or re-trigger Replace All. Escape cancels; Enter/Space/Tab stay available
  // for the focused Cancel button.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void handleCancel();
        return;
      }
      const onCancelButton = e.target === cancelRef.current;
      const passthrough = onCancelButton && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab');
      if (!passthrough) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleCancel]);

  const percent = progress.totalBytes > 0
    ? Math.min(100, Math.floor((progress.bytesDone / progress.totalBytes) * 100))
    : 0;

  return (
    <div className={`${styles.overlay} ${visible ? styles.overlayVisible : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      {visible && (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('search.replacing')}>
          <p className={styles.title}>{t('search.replacing')}</p>
          <div
            className={styles.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className={styles.barFill} style={{ width: `${percent}%` }} />
          </div>
          <div className={styles.stats}>
            <span>
              {percent}% ({formatBytes(progress.bytesDone)} / {formatBytes(progress.totalBytes)})
            </span>
            <span>{t('search.replaceMatches', { count: progress.matches.toLocaleString() })}</span>
          </div>
          <div className={styles.actions}>
            <button
              ref={cancelRef}
              type="button"
              className={styles.btnSecondary}
              disabled={progress.cancelling}
              onClick={() => { void handleCancel(); }}
            >
              {progress.cancelling ? t('search.replaceCancelling') : t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Modal progress overlay for Replace All; renders nothing while idle. */
export const ReplaceProgressDialog: React.FC = () => {
  const [progress] = useAtom(replaceProgressAtom);
  if (!progress) return null;
  // Remount per job so the show-delay restarts.
  return <ReplaceProgressModal key={progress.bufferId} progress={progress} />;
};
