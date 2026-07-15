import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { VirtualScrollbar } from './VirtualScrollbar';
import { EditorState, Compartment, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  keymap,
} from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

import { columnModeExtension } from '../../extensions/columnMode';
import { chromiumImeAutocorrectWorkaround } from '../../extensions/chromiumImeAutocorrectWorkaround';
import { smartEnterKey } from '../../extensions/smartEnter';
import { searchMatchField, searchHighlightTheme } from '../../extensions/searchHighlight';
import { buildWordfileLanguage } from '../../extensions/wordfileSyntax';
import {
  editorPrefsAtom,
  columnModeAtom,
  languageDefsAtom,
  tabsAtom,
} from '../../store/atoms';
import { getLines, getFullText } from '../../store/tauriCommands';
import {
  registerEditorView,
  unregisterEditorView,
  markTextEdited,
  markCursorMoved,
  registerJumpToLine,
  unregisterJumpToLine,
  registerReloadWindow,
  unregisterReloadWindow,
  setWindowRange,
  syncEditorToRust,
  registerPeerSetter,
  unregisterPeerSetter,
  registerSecondaryEditorView,
  unregisterSecondaryEditorView,
  syncAnnotation,
} from '../../store/editorViewRegistry';
import { virtualLoad } from '../../store/virtualLoadAnnotation';
import type { TabState } from '../../types';
import type { PaneId } from '../../store/splitAtoms';

// Compartments allow hot-swapping extensions without rebuilding the full state
const wrapComp = new Compartment();
const langComp = new Compartment();
const themeComp = new Compartment();
const columnComp = new Compartment();
const fontComp = new Compartment();
// Line-number offset compartment: reconfigured on window jumps so the gutter
// always shows the real file line number, not the CM-local line number.
const lineNumComp = new Compartment();

interface EditorProps {
  tab: TabState;
  onCursorChange: (line: number, col: number) => void;
  paneId?: PaneId;
}

// Lines per IPC fetch; also the size of the initial viewport load.
const CHUNK_SIZE = 300;
// Start prefetching the next chunk when the user scrolls within this many
// lines of the end of already-loaded content.
const PREFETCH_LINES = 80;

export const Editor: React.FC<EditorProps> = ({ tab, onCursorChange, paneId = 'primary' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** Reference to the other pane's EditorView (when split is active and same bufferId). */
  const peerViewRef = useRef<EditorView | null>(null);
  const prefs = useAtomValue(editorPrefsAtom);
  const columnMode = useAtomValue(columnModeAtom);
  const langDefs = useAtomValue(languageDefsAtom);
  const setTabs = useSetAtom(tabsAtom);
  const setTabsRef = useRef(setTabs);
  useEffect(() => { setTabsRef.current = setTabs; }, [setTabs]);
  const prevBufferIdRef = useRef<number>(-1);
  const loadingRef = useRef(false);
  // ── Virtual scrollbar state (0-1 fractions of the full file) ──
  const [vsbInfo, setVsbInfo] = useState({ top: 0, size: 1 });
  const vsbSizeRef = useRef(1);

  // ── Incremental-loading state ──────────────────────────────────
  // These refs are the source of truth for the virtual-window position.
  const activeBufferIdRef = useRef<number>(-1);
  // 0-based line in the file where the CM doc currently starts.
  const windowStartLineRef = useRef<number>(0);
  // UTF-8 byte offset in the full file where the CM doc starts.
  const windowStartByteOffsetRef = useRef<number>(0);
  // 0-based line in the file just after the last loaded line (absolute).
  const loadedEndLineRef = useRef<number>(0);
  const totalLinesRef = useRef<number>(0);    // total lines in the Rust Rope
  const isAppendingRef = useRef<boolean>(false);

  // ── Update virtual-scrollbar thumb position and size ─────────────
  // Called whenever the CM viewport changes or the virtual window shifts.
  // All values are 0-1 fractions relative to the full file.
  //
  // `overrideTopLine` bypasses the scrollTop-based calculation: use it right
  // after a jumpToWindow so the thumb lands exactly at the seeked line even
  // before CM finishes its async scroll animation.
  const updateScrollbar = useCallback((view: EditorView, overrideTopLine?: number) => {
    const totalLines = totalLinesRef.current;
    if (totalLines === 0) {
      setVsbInfo({ top: 0, size: 1 });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
    const winStart = windowStartLineRef.current;
    const winLines = Math.max(loadedEndLineRef.current - winStart, 1);

    let topFileLine: number;
    if (overrideTopLine !== undefined) {
      topFileLine = overrideTopLine;
    } else {
      const loadedFraction = scrollHeight > clientHeight
        ? scrollTop / (scrollHeight - clientHeight)
        : 0;
      topFileLine = winStart + loadedFraction * winLines;
    }

    const thumbTop = topFileLine / totalLines;
    const thumbSize = Math.max(
      (clientHeight / Math.max(scrollHeight, 1)) * (winLines / totalLines),
      0.02,
    );
    setVsbInfo({ top: Math.min(thumbTop, 1 - thumbSize), size: thumbSize });
    vsbSizeRef.current = thumbSize;
  }, []);

  /** Map thumb-top ratio (0-1) to the first file line that should appear at the top of the viewport. */
  const ratioToFirstVisibleLine = useCallback((ratio: number): number => {
    const totalLines = totalLinesRef.current;
    if (totalLines <= 1) return 0;
    const size = vsbSizeRef.current;
    const linesInView = Math.max(1, Math.ceil(totalLines * size));
    const maxFirst = Math.max(0, totalLines - linesInView);
    if (size >= 1 - 1e-9) return 0;
    const scrollFraction = Math.max(0, Math.min(1, ratio / (1 - size)));
    return Math.floor(scrollFraction * maxFirst);
  }, []);

  // ── Append next chunk when scrolling near the loaded-content end ─
  const maybeLoadMore = useCallback((view: EditorView) => {
    if (isAppendingRef.current) return;
    const bufferId = activeBufferIdRef.current;
    const loadedEnd = loadedEndLineRef.current; // absolute file line
    const total = totalLinesRef.current;
    if (loadedEnd >= total || bufferId < 0) return;

    // Trigger prefetch when the viewport is within PREFETCH_LINES of the
    // bottom of the loaded content.
    const docLines = view.state.doc.lines;
    const vpTo = Math.min(view.viewport.to, view.state.doc.length - 1);
    const lastVisible = view.state.doc.lineAt(vpTo).number; // 1-based
    if (lastVisible < docLines - PREFETCH_LINES) return;

    isAppendingRef.current = true;
    getLines(bufferId, loadedEnd, CHUNK_SIZE)
      .then((chunk) => {
        if (activeBufferIdRef.current !== bufferId) return; // tab switched during fetch
        if (chunk.lines.length === 0) {
          loadedEndLineRef.current = total; // signal: nothing more to load
          return;
        }
        const appendText = '\n' + chunk.lines.join('\n');
        const docLen = view.state.doc.length;
        view.dispatch({
          changes: { from: docLen, to: docLen, insert: appendText },
          annotations: [virtualLoad.of(true), Transaction.addToHistory.of(false)],
        });
        loadedEndLineRef.current = loadedEnd + chunk.lines.length;
        // Extend the window's end byte offset as new content is appended.
        setWindowRange(bufferId, windowStartByteOffsetRef.current, chunk.end_byte_offset);
        updateScrollbar(view);
      })
      .catch((err) => console.error('[Editor] maybeLoadMore failed:', err))
      .finally(() => {
        isAppendingRef.current = false;
        // Re-check: the user may have scrolled further while we were loading.
        const newLoadedEnd = loadedEndLineRef.current;
        if (activeBufferIdRef.current === bufferId && newLoadedEnd < totalLinesRef.current) {
          const newDocLines = view.state.doc.lines;
          const vpTo2 = Math.min(view.viewport.to, view.state.doc.length - 1);
          const lastVis2 = view.state.doc.lineAt(vpTo2).number;
          if (lastVis2 >= newDocLines - PREFETCH_LINES) {
            setTimeout(() => maybeLoadMore(view), 0);
          }
        }
      });
  }, []);

  // ── Slide the virtual-document window to cover a target line ──────
  // Called by highlightSearchMatches when the active search match falls outside
  // the currently loaded CM segment. Instead of loading all intervening content
  // (which would defeat the purpose of virtual documents for large files), we
  // replace the CM content with a fresh CHUNK_SIZE-line window centred on the
  // target line. Content before/after the window stays in the Rust rope only.
  //
  // Before sliding, any pending user edits in the current window are synced to
  // Rust so they are not lost when the window is replaced.
  const jumpToWindow = useCallback(async (targetLine: number) => {
    const view = viewRef.current;
    const bufferId = activeBufferIdRef.current;
    if (!view || bufferId < 0) return;

    const totalLines = totalLinesRef.current;
    const lastLine = Math.max(0, totalLines - 1);
    targetLine = Math.max(0, Math.min(targetLine, lastLine));

    const size = vsbSizeRef.current;
    const linesInView = Math.max(1, Math.ceil(totalLines * size));
    const maxFirstLine = Math.max(0, totalLines - linesInView);
    const seekToBottom = targetLine >= maxFirstLine;

    // Wait for any concurrent maybeLoadMore to finish first.
    while (isAppendingRef.current) {
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    const scrollToTarget = (winStart: number) => {
      if (seekToBottom) {
        const lastCmLine = view.state.doc.lines;
        view.dispatch({
          effects: EditorView.scrollIntoView(
            view.state.doc.line(lastCmLine).from,
            { y: 'end' },
          ),
        });
        updateScrollbar(view, maxFirstLine);
      } else {
        const cmLineNum = Math.min(
          targetLine - winStart + 1,
          view.state.doc.lines,
        );
        view.dispatch({
          effects: EditorView.scrollIntoView(
            view.state.doc.line(cmLineNum).from,
            { y: 'start' },
          ),
        });
        updateScrollbar(view, targetLine);
      }
    };

    // Already covered by the current window: scroll CM to the target line
    // and update the scrollbar without reloading.
    if (targetLine >= windowStartLineRef.current && targetLine < loadedEndLineRef.current) {
      scrollToTarget(windowStartLineRef.current);
      return;
    }

    // Flush any user edits in the current window to Rust before replacing it.
    await syncEditorToRust(bufferId);

    isAppendingRef.current = true;
    try {
      const startLine = seekToBottom
        ? Math.max(0, totalLines - CHUNK_SIZE)
        : Math.max(0, targetLine - Math.floor(CHUNK_SIZE / 2));
      const chunk = await getLines(bufferId, startLine, CHUNK_SIZE);
      if (activeBufferIdRef.current !== bufferId) return; // tab switched during fetch

      // Replace the entire CM document with the new window and update the line-number
      // gutter offset in a single transaction so the gutter immediately shows real
      // file line numbers (e.g. line 901 instead of 1 when window starts at file line 900).
      const newWinStart = chunk.start_line;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: chunk.lines.join('\n') },
        annotations: [virtualLoad.of(true), Transaction.addToHistory.of(false)],
        effects: lineNumComp.reconfigure(
          lineNumbers({ formatNumber: (n) => String(newWinStart + n) }),
        ),
      });

      windowStartLineRef.current = chunk.start_line;
      windowStartByteOffsetRef.current = chunk.start_byte_offset;
      loadedEndLineRef.current = chunk.start_line + chunk.lines.length;
      setWindowRange(bufferId, chunk.start_byte_offset, chunk.end_byte_offset);
      scrollToTarget(chunk.start_line);
    } finally {
      isAppendingRef.current = false;
    }
  }, [updateScrollbar]);

  // ── Reload current window from Rust (called after replace operations) ──────
  // Re-fetches the same window position and replaces CM content without
  // touching the virtual-load / user-edit bookkeeping.
  const reloadCurrentWindowFn = useCallback(async () => {
    const view = viewRef.current;
    const bufferId = activeBufferIdRef.current;
    if (!view || bufferId < 0) return;

    while (isAppendingRef.current) {
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    isAppendingRef.current = true;
    try {
      const startLine = windowStartLineRef.current;
      const lineCount = Math.max(loadedEndLineRef.current - startLine, CHUNK_SIZE);
      const chunk = await getLines(bufferId, startLine, lineCount);
      if (activeBufferIdRef.current !== bufferId) return;

      const newWinStart = chunk.start_line;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: chunk.lines.join('\n') },
        annotations: [virtualLoad.of(true), Transaction.addToHistory.of(false)],
        effects: lineNumComp.reconfigure(
          newWinStart === 0
            ? lineNumbers()
            : lineNumbers({ formatNumber: (n) => String(newWinStart + n) }),
        ),
      });

      windowStartLineRef.current = chunk.start_line;
      windowStartByteOffsetRef.current = chunk.start_byte_offset;
      loadedEndLineRef.current = chunk.start_line + chunk.lines.length;
      totalLinesRef.current = chunk.total_lines;
      setWindowRange(bufferId, chunk.start_byte_offset, chunk.end_byte_offset);
      updateScrollbar(view);
    } finally {
      isAppendingRef.current = false;
    }
  }, [updateScrollbar]);

  // ── Initial load: first viewport only (virtual-document design) ─
  // totalLines is stored so maybeLoadMore knows when to stop.
  // Only the first CHUNK_SIZE lines are fetched here; the rest load on scroll.
  const loadContent = useCallback(async (bufferId: number, view: EditorView, totalLines: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    // Reset virtual-window state for the new buffer.
    activeBufferIdRef.current = bufferId;
    totalLinesRef.current = totalLines;
    windowStartLineRef.current = 0;
    windowStartByteOffsetRef.current = 0;
    loadedEndLineRef.current = 0;
    isAppendingRef.current = false;

    try {
      const chunk = await getLines(bufferId, 0, CHUNK_SIZE);
      if (activeBufferIdRef.current !== bufferId) return; // guard against race
      // Update refs BEFORE dispatch: the update listener fires synchronously inside
      // dispatch and calls maybeLoadMore, which reads these refs. If they still hold
      // their reset values (0) at that point, maybeLoadMore would fetch line 0 again
      // and append a duplicate of the content — visible as doubled text on small files.
      loadedEndLineRef.current = chunk.lines.length;
      setWindowRange(bufferId, chunk.start_byte_offset, chunk.end_byte_offset);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: chunk.lines.join('\n') },
        annotations: [virtualLoad.of(true), Transaction.addToHistory.of(false)],
        // Reset line-number formatter to default (window starts at file line 0).
        effects: lineNumComp.reconfigure(lineNumbers()),
      });
      updateScrollbar(view);
    } catch (err) {
      console.error('[Editor] loadContent failed:', err);
    } finally {
      loadingRef.current = false;
    }
  }, [updateScrollbar]);

  // ── Build the language extension for this tab ──────────────────
  const buildLangExtension = useCallback((): Extension => {
    const ext = tab.language;
    if (!ext) return [];

    // Check wordfile definitions first
    for (const def of langDefs) {
      if (def.extensions.includes(ext)) {
        return buildWordfileLanguage(def);
      }
    }

    // Fall back to built-in CM6 languages loaded lazily
    return [];
  }, [tab.language, langDefs]);

  // ── Editor setup (runs once per mount) ────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.selectionSet) {
        const sel = update.state.selection.main;
        const line = update.state.doc.lineAt(sel.head);
        onCursorChange(windowStartLineRef.current + line.number - 1, sel.head - line.from);

        const isVirtualOrSync = update.transactions.some(
          (tr) => tr.annotation(virtualLoad) || tr.annotation(syncAnnotation)
        );
        if (!isVirtualOrSync) {
          markCursorMoved(tab.bufferId);
        }
      }
      // Trigger incremental load when the user scrolls near the loaded-content bottom.
      if (update.viewportChanged) {
        maybeLoadMore(update.view);
        updateScrollbar(update.view);
      }
      // Detect user text edits (excluding virtual loads from Rust).
      if (update.docChanged) {
        const hasUserEdit = update.transactions.some(
          (tr) => tr.docChanged && !tr.annotation(virtualLoad)
        );
        if (hasUserEdit) {
          markTextEdited(tab.bufferId);
          const bufId = tab.bufferId;
          setTabsRef.current((prev) =>
            prev.map((t) =>
              t.bufferId === bufId && !t.fileInfo.is_modified
                ? { ...t, fileInfo: { ...t.fileInfo, is_modified: true } }
                : t
            )
          );
          // Forward text changes to the peer view (split view sync).
          // Skip virtualLoad transactions and transactions that already carry
          // the syncAnnotation to prevent infinite forwarding loops.
          const peer = peerViewRef.current;
          if (peer) {
            for (const tr of update.transactions) {
              if (
                tr.docChanged &&
                !tr.annotation(virtualLoad) &&
                !tr.annotation(syncAnnotation)
              ) {
                peer.dispatch({
                  changes: tr.changes,
                  annotations: [syncAnnotation.of(true)],
                });
              }
            }
          }
        }
      }
    });

    // Custom select-all: when the file is only partially loaded (virtual window),
    // fetch the full text from Rust first so that subsequent delete/paste operates
    // on the entire document rather than just the visible chunk.
    const selectAllHandler = (view: EditorView): boolean => {
      const totalLines = totalLinesRef.current;
      const winStart = windowStartLineRef.current;
      const loadedEnd = loadedEndLineRef.current;
      const bufferId = activeBufferIdRef.current;

      if (bufferId < 0) return false;

      // File already fully loaded in CM → let default selectAll handle it
      if (winStart === 0 && loadedEnd >= totalLines) return false;

      void (async () => {
        try {
          while (isAppendingRef.current) {
            await new Promise<void>((r) => setTimeout(r, 50));
          }

          // Another concurrent selectAll may have finished loading already
          if (windowStartLineRef.current === 0 &&
              loadedEndLineRef.current >= totalLinesRef.current) {
            view.dispatch({
              selection: { anchor: 0, head: view.state.doc.length },
            });
            return;
          }

          isAppendingRef.current = true;

          await syncEditorToRust(bufferId);
          const text = await getFullText(bufferId);
          if (activeBufferIdRef.current !== bufferId) return;

          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: [virtualLoad.of(true), Transaction.addToHistory.of(false)],
            effects: lineNumComp.reconfigure(lineNumbers()),
          });

          const textByteLen = new TextEncoder().encode(text).length;
          windowStartLineRef.current = 0;
          windowStartByteOffsetRef.current = 0;
          loadedEndLineRef.current = view.state.doc.lines;
          totalLinesRef.current = view.state.doc.lines;
          setWindowRange(bufferId, 0, textByteLen);
          updateScrollbar(view);

          view.dispatch({
            selection: { anchor: 0, head: view.state.doc.length },
          });
        } catch (err) {
          console.error('[Editor] selectAll full load failed:', err);
        } finally {
          isAppendingRef.current = false;
        }
      })();

      return true;
    };

    const state = EditorState.create({
      doc: '',
      extensions: [
        history(),
        lineNumComp.of(lineNumbers()),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        foldGutter(),
        keymap.of([
          indentWithTab,
          smartEnterKey,
          { key: 'Mod-a', run: selectAllHandler },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        searchMatchField,
        searchHighlightTheme,
        updateListener,
        wrapComp.of(prefs.lineWrap ? EditorView.lineWrapping : []),
        langComp.of(buildLangExtension()),
        themeComp.of(prefs.theme === 'dark' ? oneDark : []),
        columnComp.of(columnMode ? columnModeExtension() : []),
        fontComp.of(EditorView.theme({
          '&': { fontSize: `${prefs.fontSize}px`, height: '100%' },
          // CM base theme sets fontFamily on .cm-scroller, so we must override it there too.
          '.cm-scroller': { fontFamily: prefs.fontFamily, overflow: 'auto' },
          '.cm-content': { fontFamily: prefs.fontFamily, minHeight: '100%' },
        })),
        chromiumImeAutocorrectWorkaround(),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    const setPeer = (v: EditorView | null) => { peerViewRef.current = v; };

    if (paneId === 'secondary') {
      registerSecondaryEditorView(tab.bufferId, view, setPeer);
    } else {
      registerEditorView(tab.bufferId, view);
      registerPeerSetter(tab.bufferId, setPeer);
    }
    registerJumpToLine(tab.bufferId, jumpToWindow);
    registerReloadWindow(tab.bufferId, reloadCurrentWindowFn);

    // Small files may fit entirely inside CM's render viewport, so wheel
    // scrolling only changes scrollTop without firing viewportChanged.
    const onScrollerScroll = () => updateScrollbar(view);
    view.scrollDOM.addEventListener('scroll', onScrollerScroll, { passive: true });

    loadContent(tab.bufferId, view, tab.fileInfo.total_lines);
    view.focus();
    prevBufferIdRef.current = tab.bufferId;

    return () => {
      // Flush any unsaved user edits to Rust before destroying the CM view.
      // syncEditorToRust captures the document text and window range synchronously,
      // then sends the IPC call fire-and-forget. This must run before
      // unregisterEditorView clears the registry and windowRangeMap.
      syncEditorToRust(prevBufferIdRef.current).catch(console.error);

      view.scrollDOM.removeEventListener('scroll', onScrollerScroll);
      if (paneId === 'secondary') {
        unregisterSecondaryEditorView(prevBufferIdRef.current, () => { peerViewRef.current = null; });
      } else {
        unregisterEditorView(prevBufferIdRef.current);
        unregisterPeerSetter(prevBufferIdRef.current);
      }
      unregisterJumpToLine(prevBufferIdRef.current);
      unregisterReloadWindow(prevBufferIdRef.current);
      view.destroy();
      viewRef.current = null;
      loadingRef.current = false;
      peerViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reload when buffer changes (tab switch or reopen-with-encoding) ──
  useEffect(() => {
    const view = viewRef.current;
    if (!view || tab.bufferId === prevBufferIdRef.current) return;

    const prevId = prevBufferIdRef.current;
    unregisterJumpToLine(prevId);
    unregisterReloadWindow(prevId);
    // Disconnect peer for the old buffer.
    if (paneId === 'secondary') {
      unregisterSecondaryEditorView(prevId, () => { peerViewRef.current = null; });
    } else {
      unregisterPeerSetter(prevId);
    }

    prevBufferIdRef.current = tab.bufferId;

    const setPeer = (v: EditorView | null) => { peerViewRef.current = v; };
    if (paneId === 'secondary') {
      registerSecondaryEditorView(tab.bufferId, view, setPeer);
    } else {
      registerEditorView(tab.bufferId, view);
      registerPeerSetter(tab.bufferId, setPeer);
    }
    registerJumpToLine(tab.bufferId, jumpToWindow);
    registerReloadWindow(tab.bufferId, reloadCurrentWindowFn);
    loadContent(tab.bufferId, view, tab.fileInfo.total_lines);
    view.focus();
  }, [tab.bufferId, paneId, loadContent, jumpToWindow, reloadCurrentWindowFn]);

  // ── Hot-swap: line wrap ────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapComp.reconfigure(prefs.lineWrap ? EditorView.lineWrapping : []),
    });
  }, [prefs.lineWrap]);

  // ── Hot-swap: theme ────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.reconfigure(prefs.theme === 'dark' ? oneDark : []),
    });
  }, [prefs.theme]);

  // ── Hot-swap: column mode ──────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: columnComp.reconfigure(columnMode ? columnModeExtension() : []),
    });
  }, [columnMode]);

  // ── Hot-swap: language ─────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.reconfigure(buildLangExtension()),
    });
  }, [buildLangExtension]);

  // ── Hot-swap: font size / font family ─────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: fontComp.reconfigure(EditorView.theme({
        '&': { fontSize: `${prefs.fontSize}px`, height: '100%' },
        '.cm-scroller': { fontFamily: prefs.fontFamily, overflow: 'auto' },
        '.cm-content': { fontFamily: prefs.fontFamily, minHeight: '100%' },
      })),
    });
  }, [prefs.fontSize, prefs.fontFamily]);

  // ── Scrollbar seek: "latest-wins" to prevent IPC call pile-up ────
  // If a window jump is already in progress, store the latest target and
  // process it once the current jump finishes instead of queuing many jumps.
  const pendingSeekLineRef = useRef<number | null>(null);
  const seekingRef = useRef(false);

  const doSeekLine = useCallback((line: number) => {
    if (seekingRef.current) {
      pendingSeekLineRef.current = line;
      return;
    }
    seekingRef.current = true;
    pendingSeekLineRef.current = null;
    void jumpToWindow(line).finally(() => {
      seekingRef.current = false;
      const pending = pendingSeekLineRef.current;
      if (pending !== null) {
        pendingSeekLineRef.current = null;
        doSeekLine(pending);
      }
    });
  }, [jumpToWindow]);

  const handleSeek = useCallback((ratio: number) => {
    doSeekLine(ratioToFirstVisibleLine(ratio));
  }, [doSeekLine, ratioToFirstVisibleLine]);

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        className="editor-container"
        style={{ flex: 1, overflow: 'hidden', fontFamily: prefs.fontFamily }}
      />
      <VirtualScrollbar top={vsbInfo.top} size={vsbInfo.size} onSeek={handleSeek} />
    </div>
  );
};
