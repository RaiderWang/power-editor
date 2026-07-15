import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  searchOpenAtom,
  searchParamsAtom,
  searchMatchesAtom,
  searchTotalAtom,
  currentMatchIndexAtom,
  activeTabAtom,
  activeTabIdAtom,
  searchTriggerAtom,
  tabsAtom,
} from '../../store/atoms';
import * as cmd from '../../store/tauriCommands';
import {
  getSelectedText,
  clearAllSearchHighlights,
  reloadCurrentWindow,
  syncEditorToRust,
  isSearchStale,
  clearSearchStale,
  markSearchStale,
  getAbsoluteCursorByteOffset,
  applyReplaceEditToCM,
  hasCursorMoved,
  clearCursorMoved,
} from '../../store/editorViewRegistry';
import type { SearchMatch } from '../../types';
import styles from './SearchPanel.module.css';
import { LineListDialog } from './LineListDialog';
import { HistoryComboInput } from './HistoryComboInput';
import { expandSpecialChars, SPECIAL_CHAR_DEFS } from '../../utils/specialChars';
import { useTranslation } from '../../i18n';
import {
  loadSearchHistory,
  addSearchHistory,
  loadReplaceHistory,
  addReplaceHistory,
} from '../../store/searchHistory';

interface SearchPanelProps {
  onMatchesFound?: (matches: SearchMatch[], current: number) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ onMatchesFound }) => {
  const [open, setOpen] = useAtom(searchOpenAtom);
  const [params, setParams] = useAtom(searchParamsAtom);
  const [matches, setMatches] = useAtom(searchMatchesAtom);
  const [total, setTotal] = useAtom(searchTotalAtom);
  const [currentIdx, setCurrentIdx] = useAtom(currentMatchIndexAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const searchTrigger = useAtomValue(searchTriggerAtom);

  const setTabs = useSetAtom(tabsAtom);
  const setActiveTabId = useSetAtom(activeTabIdAtom);

  const t = useTranslation();
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [searchSelectTrigger, setSearchSelectTrigger] = useState(0);
  const [listLines, setListLines] = useState(false);
  const [showLineList, setShowLineList] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadSearchHistory());
  const [replaceHistory, setReplaceHistory] = useState<string[]>(() => loadReplaceHistory());
  const [searching, setSearching] = useState(false);

  // 记录上一次搜索时使用的 pattern，用于判断是否需要重新搜索
  const lastSearchedPattern = useRef<string>('');

  // 标签切换时：清除旧搜索结果；若面板已开启且有关键词，立即在新标签重新搜索（Bug 2 修复）
  useEffect(() => {
    setMatches([]);
    setTotal(0);
    setCurrentIdx(-1);
    setShowLineList(false);
    lastSearchedPattern.current = '';
    // 面板打开且有关键词时，在新标签页立即触发搜索，使上下箭头可以正常工作
    if (open && params.pattern && activeTab) {
      doSearch();
    }
  // open / params / doSearch 不放入 deps：它们在 activeTab.id 变化的同一次渲染中已更新，
  // 闭包捕获的值是正确的；加入 deps 反而会导致不必要的重复搜索。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

  // 每次触发「打开/重新打开」时，有选区则填入，否则填入最近一次查找历史，并全选输入框内容
  useEffect(() => {
    if (!activeTab || searchTrigger === 0) return;
    const selected = getSelectedText(activeTab.bufferId);
    if (selected) {
      setParams((prev) => ({ ...prev, pattern: selected }));
    } else {
      const history = loadSearchHistory();
      if (history.length > 0) {
        setParams((prev) => ({ ...prev, pattern: history[0] }));
      }
    }
    setSearchSelectTrigger((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // 关闭面板时清除所有标签页的高亮（Bug 1 修复）
  // 仅清除当前活动标签不够：其他标签页可能因之前的搜索留有高亮装饰
  useEffect(() => {
    if (!open) {
      clearAllSearchHighlights();
    }
  }, [open]);

  // 展开替换区时自动填入最近一次替换历史（仅在替换框为空时）
  useEffect(() => {
    if (!showReplace) return;
    if (replaceText === '') {
      const history = loadReplaceHistory();
      if (history.length > 0) {
        setReplaceText(history[0]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReplace]);

  const listLinesRef = useRef(listLines);
  listLinesRef.current = listLines;

  const doSearch = useCallback(async () => {
    if (!activeTab || !params.pattern) return;
    lastSearchedPattern.current = params.pattern;
    setSearching(true);
    try {
      await syncEditorToRust(activeTab.bufferId);
      const searchParams = params.is_regex
        ? params
        : { ...params, pattern: expandSpecialChars(params.pattern) };
      const result = await cmd.findAll(activeTab.bufferId, searchParams, 10000);
      clearSearchStale(activeTab.bufferId);
      clearCursorMoved(activeTab.bufferId);
      setMatches(result.matches);
      setTotal(result.total);
      const newIdx = result.matches.length > 0 ? 0 : -1;
      setCurrentIdx(newIdx);
      onMatchesFound?.(result.matches, newIdx);
    } finally {
      setSearching(false);
    }
  }, [activeTab, params, setMatches, setTotal, setCurrentIdx, onMatchesFound]);

  const refreshMatches = useCallback(async (): Promise<SearchMatch[]> => {
    if (!activeTab || !params.pattern) return [];
    setSearching(true);
    try {
      await syncEditorToRust(activeTab.bufferId);
      const searchParams = params.is_regex
        ? params
        : { ...params, pattern: expandSpecialChars(params.pattern) };
      const result = await cmd.findAll(activeTab.bufferId, searchParams, 10000);
      clearSearchStale(activeTab.bufferId);
      setMatches(result.matches);
      setTotal(result.total);
      return result.matches;
    } finally {
      setSearching(false);
    }
  }, [activeTab, params, setMatches, setTotal]);

  const nextMatchIndex = (fresh: SearchMatch[], cursorByte: number): number => {
    const idx = fresh.findIndex((m) => m.from > cursorByte);
    return idx >= 0 ? idx : 0;
  };

  const prevMatchIndex = (fresh: SearchMatch[], cursorByte: number): number => {
    for (let i = fresh.length - 1; i >= 0; i--) {
      if (fresh[i].from < cursorByte) return i;
    }
    return fresh.length - 1;
  };

  // 输入清空时清除结果；输入变化时标记结果已过时（不自动搜索，按 Enter / 点箭头才搜）
  useEffect(() => {
    if (!params.pattern) {
      setMatches([]);
      setTotal(0);
      setCurrentIdx(-1);
      lastSearchedPattern.current = '';
      if (activeTab) clearAllSearchHighlights();
    } else if (activeTab) {
      markSearchStale(activeTab.bufferId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.pattern, params.case_sensitive, params.whole_word, params.is_regex]);

  const gotoNext = useCallback(async () => {
    if (!params.pattern || !activeTab) return;
    addSearchHistory(params.pattern);
    setSearchHistory(loadSearchHistory());
    const stale = isSearchStale(activeTab.bufferId);
    if (!matches.length || stale) {
      lastSearchedPattern.current = params.pattern;
      const fresh = await refreshMatches();
      if (fresh.length === 0) {
        setCurrentIdx(-1);
        onMatchesFound?.(fresh, -1);
        return;
      }
      const cursorByte = getAbsoluteCursorByteOffset(activeTab.bufferId) ?? 0;
      const next = stale ? nextMatchIndex(fresh, cursorByte) : 0;
      clearCursorMoved(activeTab.bufferId);
      setCurrentIdx(next);
      onMatchesFound?.(fresh, next);
      if (listLinesRef.current) setShowLineList(true);
      return;
    }
    let next: number;
    if (hasCursorMoved(activeTab.bufferId)) {
      const cursorByte = getAbsoluteCursorByteOffset(activeTab.bufferId) ?? 0;
      next = nextMatchIndex(matches, cursorByte);
      clearCursorMoved(activeTab.bufferId);
    } else {
      next = (currentIdx + 1) % matches.length;
    }
    setCurrentIdx(next);
    onMatchesFound?.(matches, next);
    if (listLinesRef.current) setShowLineList(true);
  }, [matches, currentIdx, setCurrentIdx, onMatchesFound, params, activeTab, refreshMatches]);

  const gotoPrev = useCallback(async () => {
    if (!params.pattern || !activeTab) return;
    addSearchHistory(params.pattern);
    setSearchHistory(loadSearchHistory());
    const stale = isSearchStale(activeTab.bufferId);
    if (!matches.length || stale) {
      lastSearchedPattern.current = params.pattern;
      const fresh = await refreshMatches();
      if (fresh.length === 0) {
        setCurrentIdx(-1);
        onMatchesFound?.(fresh, -1);
        return;
      }
      const cursorByte = getAbsoluteCursorByteOffset(activeTab.bufferId) ?? 0;
      const prev = stale ? prevMatchIndex(fresh, cursorByte) : fresh.length - 1;
      clearCursorMoved(activeTab.bufferId);
      setCurrentIdx(prev);
      onMatchesFound?.(fresh, prev);
      if (listLinesRef.current) setShowLineList(true);
      return;
    }
    let prev: number;
    if (hasCursorMoved(activeTab.bufferId)) {
      const cursorByte = getAbsoluteCursorByteOffset(activeTab.bufferId) ?? 0;
      prev = prevMatchIndex(matches, cursorByte);
      clearCursorMoved(activeTab.bufferId);
    } else {
      prev = (currentIdx - 1 + matches.length) % matches.length;
    }
    setCurrentIdx(prev);
    onMatchesFound?.(matches, prev);
    if (listLinesRef.current) setShowLineList(true);
  }, [matches, currentIdx, setCurrentIdx, onMatchesFound, params, activeTab, refreshMatches]);

  // F3 / Shift+F3 dispatched by the global keybinding system
  useEffect(() => {
    const onNext = () => { if (open) gotoNext(); };
    const onPrev = () => { if (open) gotoPrev(); };
    document.addEventListener('keybinding:search.nextMatch', onNext);
    document.addEventListener('keybinding:search.prevMatch', onPrev);
    return () => {
      document.removeEventListener('keybinding:search.nextMatch', onNext);
      document.removeEventListener('keybinding:search.prevMatch', onPrev);
    };
  }, [open, gotoNext, gotoPrev]);

  const markTabModified = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && !t.fileInfo.is_modified
          ? { ...t, fileInfo: { ...t.fileInfo, is_modified: true } }
          : t
      )
    );
  }, [setTabs]);

  const doReplaceOne = useCallback(async () => {
    if (!activeTab || !params.pattern) return;

    // Matches may be stale if the editor content changed since the last search
    // (e.g. Ctrl+Z undo).  Using stale byte offsets would replace the wrong text.
    // Refresh first so the offsets align with the current CM/Rust content.
    let currentMatches = matches;
    let idx = currentIdx;
    if (!currentMatches.length || isSearchStale(activeTab.bufferId)) {
      const fresh = await refreshMatches();
      if (fresh.length === 0) return;
      const cursorByte = getAbsoluteCursorByteOffset(activeTab.bufferId) ?? 0;
      idx = nextMatchIndex(fresh, cursorByte);
      setCurrentIdx(idx);
      onMatchesFound?.(fresh, idx);
      currentMatches = fresh;
    }

    if (idx < 0 || !currentMatches[idx]) return;
    const m = currentMatches[idx];
    const expandedReplacement = params.is_regex ? replaceText : expandSpecialChars(replaceText);

    // Apply the replacement directly as a CM transaction so it enters the undo
    // history and can be reverted with Ctrl+Z.  syncEditorToRust inside doSearch
    // will then push the change to Rust.
    const appliedInCM = applyReplaceEditToCM(
      activeTab.bufferId,
      m.from,
      m.to,
      expandedReplacement,
    );
    if (!appliedInCM) {
      // Match is outside the current virtual window (rare fallback); not undoable.
      await cmd.replaceOne(activeTab.bufferId, m.from, m.to, expandedReplacement);
      await reloadCurrentWindow(activeTab.bufferId);
    }
    addSearchHistory(params.pattern);
    setSearchHistory(loadSearchHistory());
    addReplaceHistory(replaceText);
    setReplaceHistory(loadReplaceHistory());
    markTabModified(activeTab.id);
    await doSearch();
  }, [
    activeTab, currentIdx, matches, replaceText, params.is_regex, params.pattern,
    doSearch, markTabModified, refreshMatches, setCurrentIdx, onMatchesFound,
  ]);

  const doReplaceAll = useCallback(async () => {
    if (!activeTab || !params.pattern) return;
    // Sync any pending CM edits (including Ctrl+Z undo) to Rust before replacing,
    // so replaceAll operates on the current editor content, not a stale rope.
    await syncEditorToRust(activeTab.bufferId);
    const replaceParams = params.is_regex
      ? params
      : { ...params, pattern: expandSpecialChars(params.pattern) };
    const expandedReplacement = params.is_regex ? replaceText : expandSpecialChars(replaceText);
    const count = await cmd.replaceAll(activeTab.bufferId, replaceParams, expandedReplacement);
    await reloadCurrentWindow(activeTab.bufferId);
    addSearchHistory(params.pattern);
    setSearchHistory(loadSearchHistory());
    addReplaceHistory(replaceText);
    setReplaceHistory(loadReplaceHistory());
    markTabModified(activeTab.id);
    await doSearch();
    alert(t('search.replacedCount', { count }));
  }, [activeTab, params, replaceText, doSearch, markTabModified]);

  const handleSaveToNewFile = useCallback(async (lines: string[]) => {
    const { v4: uuidv4 } = await import('uuid');
    const fileInfo = await cmd.newBuffer();
    const content = lines.join('\n');
    await cmd.applyEdit(fileInfo.id, { from: 0, to: 0, text: content });
    const tab = {
      id: uuidv4(),
      bufferId: fileInfo.id,
      fileInfo: { ...fileInfo, is_modified: true },
      cursorLine: 0,
      cursorCol: 0,
      scrollTop: 0,
      language: null,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [setTabs, setActiveTabId]);

  if (!open) return null;

  return (
    <div className={`${styles.panel} ${searching ? styles.panelSearching : ''}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('search.title')}</span>
        <button className={styles.closeBtn} onClick={() => setOpen(false)} title={t('search.close')}>
          ✕
        </button>
      </div>

      <div className={styles.searchRow}>
        <HistoryComboInput
          placeholder={t('search.placeholder')}
          value={params.pattern}
          onChange={(v) => setParams({ ...params, pattern: v })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.shiftKey ? gotoPrev() : gotoNext();
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          history={searchHistory}
          autoFocus
          selectAllTrigger={searchSelectTrigger}
        />
        <div className={styles.navGroup}>
          <button className={styles.iconBtn} onClick={gotoPrev} disabled={searching} title={t('search.prev')}>
            ↑
          </button>
          <button className={styles.iconBtn} onClick={gotoNext} disabled={searching} title={t('search.next')}>
            ↓
          </button>
          <span className={styles.count}>
            {searching
              ? t('search.searching')
              : params.pattern
                ? matches.length > 0
                  ? `${currentIdx + 1} / ${total}${total >= 10000 ? '+' : ''}`
                  : lastSearchedPattern.current
                    ? t('search.noResult')
                    : ''
                : ''}
          </span>
        </div>
      </div>

      <div className={styles.optionsRow}>
        <div className={styles.toggles}>
          <div className={styles.helpWrapper}>
            <span className={styles.helpBtn} title={t('search.specialCharHelp')}>ℹ</span>
            <div className={styles.helpTooltip}>
              <div className={styles.helpTitle}>{t('search.specialCharTitle')}</div>
              {SPECIAL_CHAR_DEFS.map((d) => (
                <div key={d.expr} className={styles.helpRow}>
                  <code className={styles.helpExpr}>{d.expr}</code>
                  <span>{t(d.labelKey)}</span>
                </div>
              ))}
            </div>
          </div>
          <label className={styles.toggle}>
          <input type="checkbox" checked={params.case_sensitive}
            onChange={(e) => setParams({ ...params, case_sensitive: e.target.checked })} />
          {t('search.caseSensitive')}
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={params.whole_word}
            onChange={(e) => setParams({ ...params, whole_word: e.target.checked })} />
          {t('search.wholeWord')}
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={params.is_regex}
            onChange={(e) => setParams({ ...params, is_regex: e.target.checked })} />
          {t('search.regex')}
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={listLines}
            onChange={(e) => {
              const checked = e.target.checked;
              setListLines(checked);
              if (!checked) {
                setShowLineList(false);
              }
            }}
          />
          {t('search.listLines')}
          </label>
        </div>
        <button
          className={`${styles.btn} ${showReplace ? styles.btnActive : ''}`}
          onClick={() => setShowReplace(!showReplace)}
        >
          {t('search.replace')}
        </button>
      </div>

      {showReplace && (
        <div className={styles.replaceRow}>
          <HistoryComboInput
            placeholder={t('search.replacePlaceholder')}
            value={replaceText}
            onChange={setReplaceText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? doReplaceOne() : doReplaceAll();
              }
              if (e.key === 'Escape') setOpen(false);
            }}
            history={replaceHistory}
          />
          <div className={styles.replaceActions}>
            <button className={styles.btn} onClick={doReplaceOne}>
              {t('search.replaceOne')}
            </button>
            <button className={styles.btn} onClick={doReplaceAll}>
              {t('search.replaceAll')}
            </button>
          </div>
        </div>
      )}

      {showLineList && matches.length > 0 && (
        <LineListDialog
          matches={matches}
          currentIdx={currentIdx}
          onJump={(idx) => {
            setCurrentIdx(idx);
            onMatchesFound?.(matches, idx);
          }}
          onClose={() => setShowLineList(false)}
          onSaveToNewFile={handleSaveToNewFile}
        />
      )}
    </div>
  );
};
