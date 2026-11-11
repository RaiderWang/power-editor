import React, { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { Search, X } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import {
  saveWorkspaceSearchOptions,
  workspaceSearchFocusPendingAtom,
  workspaceSearchOptionsAtom,
  workspaceSearchQueryAtom,
} from '../../../store/workspaceSearch';
import type { WorkspaceSearchOptions } from '../../../store/workspaceSearch';
import styles from './WorkspaceSearch.module.css';

/**
 * Query input + options of the folder search. The root carries `data-search-panel` so the
 * editor's implicit "grab focus" side effects do not steal focus while typing.
 */
export const WorkspaceSearchBox: React.FC = () => {
  const t = useTranslation();
  const [query, setQuery] = useAtom(workspaceSearchQueryAtom);
  const [options, setOptions] = useAtom(workspaceSearchOptionsAtom);
  const [focusPending, setFocusPending] = useAtom(workspaceSearchFocusPendingAtom);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+Shift+F: focus and select the input, then consume the request so a later
  // re-mount of the sidebar (Ctrl+B) does not grab focus again.
  useEffect(() => {
    if (!focusPending) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    setFocusPending(false);
  }, [focusPending, setFocusPending]);

  const update = (patch: Partial<WorkspaceSearchOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    saveWorkspaceSearchOptions(next);
  };

  const toggle = (
    label: string,
    title: string,
    key: 'caseSensitive' | 'wholeWord' | 'isRegex',
  ) => (
    <button
      type="button"
      className={`${styles.toggleBtn} ${options[key] ? styles.active : ''}`}
      title={title}
      aria-pressed={options[key]}
      onClick={() => update({ [key]: !options[key] })}
    >
      {label}
    </button>
  );

  const isName = options.mode === 'name';

  return (
    <div className={styles.box} data-search-panel tabIndex={-1}>
      <div className={styles.inputRow}>
        <Search size={13} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={t(isName ? 'wsearch.placeholder.name' : 'wsearch.placeholder.content')}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className={styles.toggleBtn}
            title={t('wsearch.clear')}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
        {toggle('Aa', t('wsearch.caseSensitive'), 'caseSensitive')}
        {toggle('ab', t('wsearch.wholeWord'), 'wholeWord')}
        {toggle('.*', t('wsearch.regex'), 'isRegex')}
      </div>

      <div className={styles.optionsRow}>
        <div className={styles.segmented}>
          <button
            type="button"
            className={`${styles.segment} ${isName ? styles.active : ''}`}
            onClick={() => update({ mode: 'name' })}
          >
            {t('wsearch.mode.name')}
          </button>
          <button
            type="button"
            className={`${styles.segment} ${!isName ? styles.active : ''}`}
            onClick={() => update({ mode: 'content' })}
          >
            {t('wsearch.mode.content')}
          </button>
        </div>
        <label className={styles.checkLabel} title={t('wsearch.includeIgnoredTitle')}>
          <input
            type="checkbox"
            checked={options.includeIgnored}
            onChange={(e) => update({ includeIgnored: e.target.checked })}
          />
          {t('wsearch.includeIgnored')}
        </label>
      </div>
    </div>
  );
};
