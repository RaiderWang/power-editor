import React, { useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { Loader2, CheckCircle2, AlertCircle, X, ExternalLink, Download } from 'lucide-react';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { useUpdater } from '../../hooks/useUpdater';
import { useTranslation } from '../../i18n';
import { formatBytes } from '../../utils/formatBytes';
import styles from './UpdateDialog.module.css';

const markedInstance = new Marked({ gfm: true, breaks: true });

export const UpdateDialog: React.FC = () => {
  const t = useTranslation();
  const {
    status,
    details,
    progress,
    error,
    dialogOpen,
    setDialogOpen,
    checkForUpdates,
    startDownloadAndInstall,
    skipCurrentVersion,
  } = useUpdater();

  const body = details?.body;
  const releaseNotesHtml = useMemo(() => {
    if (!body) return '';
    try {
      const parsed = markedInstance.parse(body) as string;
      return DOMPurify.sanitize(parsed);
    } catch {
      return body;
    }
  }, [body]);

  if (!dialogOpen) return null;

  const handleManualDownload = () => {
    openUrl('https://github.com/RaiderWang/power-editor/releases/latest').catch(console.error);
  };

  const handleReleaseNotesClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (target && target.href && /^https?:\/\//i.test(target.href)) {
      e.preventDefault();
      openUrl(target.href).catch(console.error);
    }
  };

  return (
    <div className={styles.overlay} onClick={() => status !== 'downloading' && status !== 'installing' && setDialogOpen(false)}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleArea}>
            <span className={styles.icon}>⚡</span>
            <h3 className={styles.title}>{t('update.title')}</h3>
          </div>
          {status !== 'downloading' && status !== 'installing' && (
            <button className={styles.closeBtn} onClick={() => setDialogOpen(false)} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content based on status */}
        <div className={styles.content}>
          {status === 'checking' && (
            <div className={styles.statusMessage}>
              <Loader2 size={18} className={styles.spin} />
              <span>{t('update.checking')}</span>
            </div>
          )}

          {status === 'upToDate' && (
            <div className={styles.statusMessage}>
              <CheckCircle2 size={20} color="#10b981" />
              <span>{t('update.upToDate', { version: details?.currentVersion ?? '' })}</span>
            </div>
          )}

          {status === 'available' && details && (
            <>
              <div className={styles.versionBadgeArea}>
                <span className={styles.newVersion}>v{details.version}</span>
                <span className={styles.currentVersion}>
                  {t('update.currentIs', { version: details.currentVersion })}
                </span>
              </div>

              {releaseNotesHtml && (
                <div
                  className={styles.releaseNotes}
                  dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
                  onClick={handleReleaseNotesClick}
                />
              )}
            </>
          )}

          {status === 'downloading' && (
            <div className={styles.progressContainer}>
              <div className={styles.progressStats}>
                <span>{t('update.downloading')} ({progress.percentage}%)</span>
                <span>
                  {formatBytes(progress.downloaded)}
                  {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}
                </span>
              </div>
              <div className={styles.progressBarBg}>
                <div className={styles.progressBarFill} style={{ width: `${progress.percentage}%` }} />
              </div>
              <span style={{ fontSize: '12px', color: 'var(--app-fg-muted)' }}>
                {t('update.downloadHint')}
              </span>
            </div>
          )}

          {status === 'installing' && (
            <div className={styles.statusMessage}>
              <Loader2 size={18} className={styles.spin} />
              <span>{t('update.installing')}</span>
            </div>
          )}

          {status === 'error' && (
            <div className={styles.errorMessage}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontWeight: 600 }}>
                <AlertCircle size={16} />
                <span>{t('update.failed')}</span>
              </div>
              <div>{error || t('update.unknownError')}</div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className={styles.actions}>
          {status === 'checking' && (
            <button className={styles.btnSecondary} onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </button>
          )}

          {status === 'upToDate' && (
            <button className={styles.btnPrimary} onClick={() => setDialogOpen(false)}>
              {t('common.ok')}
            </button>
          )}

          {status === 'available' && (
            <>
              <button className={styles.btnSecondary} onClick={skipCurrentVersion}>
                {t('update.skipVersion')}
              </button>
              <button className={styles.btnSecondary} onClick={() => setDialogOpen(false)}>
                {t('update.later')}
              </button>
              <button className={styles.btnPrimary} onClick={startDownloadAndInstall}>
                <Download size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                {t('update.updateNow')}
              </button>
            </>
          )}

          {status === 'downloading' && (
            <button className={styles.btnSecondary} disabled>
              {t('update.downloading')}...
            </button>
          )}

          {status === 'installing' && (
            <button className={styles.btnPrimary} disabled>
              {t('update.installing')}...
            </button>
          )}

          {status === 'error' && (
            <>
              <button className={styles.btnSecondary} onClick={handleManualDownload}>
                <ExternalLink size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                {t('update.manualDownload')}
              </button>
              <button className={styles.btnSecondary} onClick={() => checkForUpdates(false)}>
                {t('update.retry')}
              </button>
              <button className={styles.btnPrimary} onClick={() => setDialogOpen(false)}>
                {t('common.close')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
