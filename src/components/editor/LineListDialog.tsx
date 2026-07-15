import React, { useEffect, useRef } from 'react';
import type { SearchMatch } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './LineListDialog.module.css';

interface LineListDialogProps {
  matches: SearchMatch[];
  currentIdx: number;
  onJump: (matchIdx: number) => void;
  onClose: () => void;
  onSaveToNewFile: (lines: string[]) => void;
}

/** Build a deduplicated list of lines from matches. Each entry holds the line
 *  number and the index of the first match on that line (used for jumping). */
function buildLineEntries(matches: SearchMatch[]): Array<{ line: number; firstIdx: number; preview: string }> {
  const seen = new Map<number, number>(); // line → firstIdx
  const entries: Array<{ line: number; firstIdx: number; preview: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!seen.has(m.line)) {
      seen.set(m.line, i);
      entries.push({ line: m.line, firstIdx: i, preview: m.preview.trim() });
    }
  }
  return entries;
}

export const LineListDialog: React.FC<LineListDialogProps> = ({
  matches,
  currentIdx,
  onJump,
  onClose,
  onSaveToNewFile,
}) => {
  const entries = buildLineEntries(matches);
  const activeLine = currentIdx >= 0 ? matches[currentIdx]?.line : undefined;
  const activeRowRef = useRef<HTMLDivElement>(null);
  const t = useTranslation();

  // Scroll active row into view whenever the active line changes.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeLine]);

  return (
    <div className={styles.dialog}>
      <div className={styles.header}>
        <span className={styles.title}>
          {t('lineList.header', { count: entries.length })}
        </span>
        <button
          className={styles.saveBtn}
          onClick={() => onSaveToNewFile(entries.map((e) => e.preview))}
          title={t('lineList.saveTitle')}
        >
          {t('lineList.saveBtn')}
        </button>
        <button className={styles.closeBtn} onClick={onClose} title={t('lineList.close')}>✕</button>
      </div>
      <div className={styles.list}>
        {entries.map(({ line, firstIdx, preview }) => {
          const isActive = line === activeLine;
          return (
            <div
              key={line}
              ref={isActive ? activeRowRef : undefined}
              className={`${styles.row} ${isActive ? styles.active : ''}`}
              onClick={() => onJump(firstIdx)}
              title={preview}
            >
              <span className={styles.lineNum}>{line + 1}</span>
              <span className={styles.preview}>{preview}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
