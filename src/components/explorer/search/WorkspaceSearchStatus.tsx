import React from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from '../../../i18n';
import { workspaceSearchStateAtom } from '../../../store/workspaceSearch';
import styles from './WorkspaceSearch.module.css';

/** One-line summary above the results: counts, progress and warnings. */
export const WorkspaceSearchStatus: React.FC = () => {
  const t = useTranslation();
  const state = useAtomValue(workspaceSearchStateAtom);
  const mode = state.mode;

  if (state.status === 'idle') return null;
  if (state.status === 'error') {
    return <div className={`${styles.status} ${styles.statusError}`}>{state.error}</div>;
  }

  const searching = state.status === 'searching';
  const parts: string[] = [];
  if (state.hitFiles === 0) {
    parts.push(searching ? t('wsearch.status.searching') : t('wsearch.status.noResults'));
  } else if (mode === 'name') {
    parts.push(t('wsearch.status.files', { files: state.hitFiles }));
  } else {
    parts.push(t('wsearch.status.matches', { hits: state.hitCount, files: state.hitFiles }));
  }
  if (searching) {
    parts.push(t('wsearch.status.scanned', { scanned: state.scannedFiles }));
  }

  const done = state.done;
  // Skipped binary files are routine (images, fonts…): plain info, not a warning.
  if (done && done.skipped_binary > 0 && mode === 'content') {
    parts.push(t('wsearch.status.skipped', { count: done.skipped_binary }));
  }
  const warnings: string[] = [];
  if (done?.truncated) warnings.push(t('wsearch.status.truncated'));
  if (done && done.long_lines_cut > 0) {
    warnings.push(t('wsearch.status.longLines', { count: done.long_lines_cut }));
  }

  return (
    <div className={styles.status}>
      {parts.join(' · ')}
      {warnings.length > 0 && (
        <div className={styles.statusWarn}>{warnings.join(' · ')}</div>
      )}
    </div>
  );
};
