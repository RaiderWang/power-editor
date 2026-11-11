import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { workspaceSearchStateAtom } from '../../../store/workspaceSearch';
import { HighlightedText } from './HighlightedText';
import { WorkspaceSearchStatus } from './WorkspaceSearchStatus';
import { ROW_HEIGHT, buildRows, relDir } from './searchRows';
import { useOpenSearchHit } from './useOpenSearchHit';
import styles from './WorkspaceSearch.module.css';

const OVERSCAN = 8;

/**
 * Virtualised result list (only the rows in view are rendered, fixed row height), so
 * thousands of hits stay cheap. Remounted per search job (`key`), which resets
 * scroll position and collapsed groups.
 */
const ResultsList: React.FC = () => {
  const t = useTranslation();
  const state = useAtomValue(workspaceSearchStateAtom);
  const openHit = useOpenSearchHit();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => buildRows(state.files, collapsed, state.mode),
    [state.files, collapsed, state.mode],
  );

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

  const toggleCollapsed = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        {rows.slice(first, last).map((row, i) => {
          const top = (first + i) * ROW_HEIGHT;
          if (row.kind === 'hit') {
            return (
              <div
                key={row.key}
                className={`${styles.row} ${styles.hitRow}`}
                style={{ top }}
                title={`${row.file.rel_path}:${row.hit.line + 1}`}
                onClick={() => { void openHit(row.file, row.hit); }}
              >
                <span className={styles.lineNo}>{row.hit.line + 1}</span>
                <span className={styles.preview}>
                  {row.hit.preview.length === 0 ? (
                    <span className={styles.emptyLine}>{t('wsearch.emptyLine')}</span>
                  ) : (
                    <HighlightedText
                      text={row.hit.preview}
                      start={row.hit.hl_start}
                      end={row.hit.hl_end}
                    />
                  )}
                </span>
              </div>
            );
          }

          const { file } = row;
          const isContent = state.mode === 'content';
          const dir = relDir(file.rel_path);
          return (
            <div
              key={row.key}
              className={`${styles.row} ${styles.fileRow}`}
              style={{ top }}
              title={file.rel_path}
              onClick={() => {
                if (isContent) toggleCollapsed(file.path);
                else void openHit(file);
              }}
              onDoubleClick={() => {
                if (isContent) void openHit(file);
              }}
            >
              {isContent ? (
                <span className={styles.chevron}>
                  {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </span>
              ) : (
                <span className={styles.chevron} />
              )}
              <span className={styles.fileName}>
                {file.name_hl ? (
                  <HighlightedText text={file.name} start={file.name_hl[0]} end={file.name_hl[1]} />
                ) : (
                  file.name
                )}
              </span>
              <span className={styles.dir}>{dir}</span>
              {isContent && (
                <span className={styles.badge}>
                  {file.hits.length}
                  {file.more ? '+' : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Status line + result list; rendered instead of the file tree while a query is active. */
export const WorkspaceSearchResults: React.FC = () => {
  const state = useAtomValue(workspaceSearchStateAtom);
  return (
    <div className={styles.results}>
      <WorkspaceSearchStatus />
      <ResultsList key={state.jobId ?? 'none'} />
    </div>
  );
};
