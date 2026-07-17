import { deleteLine } from '@codemirror/commands';
import { Annotation } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { applyEdit } from './tauriCommands';
import { setMatchRanges, setCurrentMatch } from '../extensions/searchHighlight';
import type { SearchMatch } from '../types';

/**
 * Annotation used to mark CM transactions that originate from peer-sync
 * forwarding, so that the receiving view does not re-forward them (loop guard).
 */
export const syncAnnotation = Annotation.define<boolean>();

/** Maps bufferId → primary EditorView, so save / search logic can read CM content. */
const registry = new Map<number, EditorView>();

/** Maps bufferId → secondary (split-pane) EditorView. */
const secondaryRegistry = new Map<number, EditorView>();

/**
 * Maps bufferId → setter that updates the peerViewRef inside the PRIMARY
 * Editor component for that buffer. When a secondary view registers, we call
 * this setter to hand the primary the secondary's view reference.
 */
const peerSetterRegistry = new Map<number, (v: EditorView | null) => void>();

/**
 * Tracks the virtual-document window position for each buffer.
 * `start` / `end` are UTF-8 byte offsets in the full Rust rope.
 *
 * - On initial load (from line 0): start = 0, end = first_chunk.end_byte_offset
 * - After a search jump: start = chunk.start_byte_offset, end = chunk.end_byte_offset
 * - After scrolling down (maybeLoadMore appends): end extends
 *
 * This is used by:
 *   1. highlightSearchMatches – to convert absolute Rust byte offsets into
 *      CM-local char offsets (subtract windowStart, then convert).
 *   2. syncEditorToRust – to replace only the correct byte range in the Rust
 *      rope when the window does not start at 0 (prevents truncating the file).
 */
const windowRangeMap = new Map<number, { start: number; end: number }>();

/**
 * Maps bufferId → jumpToWindow function registered by the corresponding Editor.
 * Signature matches (targetLine: number) => Promise<void> where targetLine is
 * the 0-based line number in the full file of the desired match.
 */
const jumpRegistry = new Map<number, (targetLine: number) => Promise<void>>();

/**
 * Maps bufferId → reloadCurrentWindow function registered by the corresponding Editor.
 * Called after replace operations to refresh the CM view from the updated Rust rope.
 */
const reloadWindowRegistry = new Map<number, () => Promise<void>>();

/**
 * Tracks which buffers have user-typed text edits (as opposed to only
 * virtual loads from Rust or metadata-only changes like encoding/line-ending).
 * Only buffers in this set need syncEditorToRust before saving.
 */
const textEditedBuffers = new Set<number>();

/** Search match lists are stale until the next findAll for this buffer. */
const searchStaleBuffers = new Set<number>();

/**
 * Tracks whether the user has moved the cursor since the last search navigation.
 * When true, gotoNext/gotoPrev will start from the cursor position instead of
 * cycling sequentially from the previous match index.
 */
const cursorMovedSinceNav = new Set<number>();

export function registerEditorView(bufferId: number, view: EditorView) {
  registry.set(bufferId, view);
}

export function unregisterEditorView(bufferId: number) {
  registry.delete(bufferId);
  peerSetterRegistry.delete(bufferId);
  textEditedBuffers.delete(bufferId);
  searchStaleBuffers.delete(bufferId);
  cursorMovedSinceNav.delete(bufferId);
  windowRangeMap.delete(bufferId);
  reloadWindowRegistry.delete(bufferId);
  // If the secondary was still registered, disconnect its peer ref.
  secondaryRegistry.delete(bufferId);
}

/**
 * Register the setter that updates the primary Editor's peerViewRef.
 * Call this right after the primary EditorView is created.
 */
export function registerPeerSetter(
  bufferId: number,
  setter: (v: EditorView | null) => void,
) {
  peerSetterRegistry.set(bufferId, setter);
  // If a secondary view is already registered, wire it immediately.
  const secondaryView = secondaryRegistry.get(bufferId);
  if (secondaryView) setter(secondaryView);
}

export function unregisterPeerSetter(bufferId: number) {
  peerSetterRegistry.delete(bufferId);
}

/**
 * Register the secondary (split-pane) EditorView for a buffer.
 * Also wires the primary's peerViewRef → secondary, and passes the primary
 * view back to the secondary via `setMyPeer`.
 */
export function registerSecondaryEditorView(
  bufferId: number,
  view: EditorView,
  setMyPeer: (v: EditorView | null) => void,
) {
  secondaryRegistry.set(bufferId, view);
  // Tell primary about secondary.
  const primarySetter = peerSetterRegistry.get(bufferId);
  if (primarySetter) primarySetter(view);
  // Tell secondary about primary.
  const primaryView = registry.get(bufferId);
  if (primaryView) setMyPeer(primaryView);
}

export function unregisterSecondaryEditorView(
  bufferId: number,
  clearMyPeer: () => void,
) {
  secondaryRegistry.delete(bufferId);
  // Disconnect the primary's peer ref.
  const primarySetter = peerSetterRegistry.get(bufferId);
  if (primarySetter) primarySetter(null);
  // Disconnect this secondary's own peer ref.
  clearMyPeer();
}

export function registerJumpToLine(bufferId: number, fn: (targetLine: number) => Promise<void>) {
  jumpRegistry.set(bufferId, fn);
}

export function unregisterJumpToLine(bufferId: number) {
  jumpRegistry.delete(bufferId);
}

export function registerReloadWindow(bufferId: number, fn: () => Promise<void>) {
  reloadWindowRegistry.set(bufferId, fn);
}

export function unregisterReloadWindow(bufferId: number) {
  reloadWindowRegistry.delete(bufferId);
}

/** Re-fetches the current virtual-document window from Rust and refreshes the CM view. */
export async function reloadCurrentWindow(bufferId: number): Promise<void> {
  const fn = reloadWindowRegistry.get(bufferId);
  if (fn) await fn();
}

export function markTextEdited(bufferId: number) {
  textEditedBuffers.add(bufferId);
  searchStaleBuffers.add(bufferId);
}

/** Clear the pending-sync flag for a buffer (e.g. after a disk reload). */
export function clearTextEdited(bufferId: number) {
  textEditedBuffers.delete(bufferId);
}

export function markSearchStale(bufferId: number) {
  searchStaleBuffers.add(bufferId);
}

export function isSearchStale(bufferId: number): boolean {
  return searchStaleBuffers.has(bufferId);
}

export function clearSearchStale(bufferId: number) {
  searchStaleBuffers.delete(bufferId);
}

export function markCursorMoved(bufferId: number) {
  cursorMovedSinceNav.add(bufferId);
}

export function clearCursorMoved(bufferId: number) {
  cursorMovedSinceNav.delete(bufferId);
}

export function hasCursorMoved(bufferId: number): boolean {
  return cursorMovedSinceNav.has(bufferId);
}

/** Caret position as a UTF-8 byte offset in the full Rust rope. */
export function getAbsoluteCursorByteOffset(bufferId: number): number | null {
  const view = registry.get(bufferId);
  if (!view) return null;
  const winStart = windowRangeMap.get(bufferId)?.start ?? 0;
  const textBefore = view.state.doc.sliceString(0, view.state.selection.main.head);
  return winStart + new TextEncoder().encode(textBefore).length;
}

/**
 * Clears all search highlight decorations from the editor for the given buffer.
 * Call this when the search panel is closed.
 */
export function clearSearchHighlights(bufferId: number): void {
  const view = registry.get(bufferId);
  if (!view) return;
  view.dispatch({
    effects: [
      setMatchRanges.of([]),
      setCurrentMatch.of(-1),
    ],
  });
}

/**
 * Clears search highlight decorations from ALL registered editors.
 * Call this when the search panel is closed to ensure no stale highlights
 * remain in tabs that were not active when the panel was closed.
 */
export function clearAllSearchHighlights(): void {
  registry.forEach((view) => {
    view.dispatch({
      effects: [
        setMatchRanges.of([]),
        setCurrentMatch.of(-1),
      ],
    });
  });
}

/**
 * Returns the currently selected text in the editor for the given buffer.
 * Returns an empty string when there is no selection or the view is not found.
 */
export function getSelectedText(bufferId: number): string {
  const view = registry.get(bufferId);
  if (!view) return '';
  const { from, to } = view.state.selection.main;
  if (from === to) return '';
  return view.state.sliceDoc(from, to);
}

/** Deletes the full line(s) containing the primary cursor in the active editor. */
export function deleteCurrentLine(bufferId: number): boolean {
  const view = registry.get(bufferId);
  if (!view) return false;
  return deleteLine(view);
}

/** Transforms the selected text to upper or lower case. Does nothing when there is no selection. */
export function transformCase(bufferId: number, transform: 'upper' | 'lower'): boolean {
  const view = registry.get(bufferId);
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const selected = view.state.sliceDoc(from, to);
  const transformed = transform === 'upper' ? selected.toUpperCase() : selected.toLowerCase();
  view.dispatch(view.state.update({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
  }));
  return true;
}

/**
 * Called by Editor whenever its virtual-document window shifts:
 * initial load, maybeLoadMore (end extends), and jumpToWindow (full shift).
 */
export function setWindowRange(bufferId: number, start: number, end: number) {
  windowRangeMap.set(bufferId, { start, end });
}

// ──────────────────────────────────────────────────────────────
// Byte-offset conversion helpers
// ──────────────────────────────────────────────────────────────

/**
 * Convert a set of UTF-8 byte offsets (relative to the start of `text`) to
 * CodeMirror character offsets in a single O(|text| + |offsets|) pass.
 */
function byteOffsetsToCharOffsets(text: string, byteOffsets: number[]): Map<number, number> {
  const sorted = [...new Set(byteOffsets)].sort((a, b) => a - b);
  const result = new Map<number, number>();
  let charIdx = 0;
  let byteCount = 0;
  let sortedIdx = 0;

  while (sortedIdx < sorted.length && charIdx <= text.length) {
    while (sortedIdx < sorted.length && byteCount >= sorted[sortedIdx]) {
      result.set(sorted[sortedIdx], charIdx);
      sortedIdx++;
    }
    if (sortedIdx >= sorted.length || charIdx >= text.length) break;
    const code = text.codePointAt(charIdx)!;
    if (code < 0x80) byteCount += 1;
    else if (code < 0x800) byteCount += 2;
    else if (code < 0x10000) byteCount += 3;
    else { byteCount += 4; charIdx++; } // surrogate pair in JS
    charIdx++;
  }
  while (sortedIdx < sorted.length) {
    result.set(sorted[sortedIdx], text.length);
    sortedIdx++;
  }
  return result;
}

// ──────────────────────────────────────────────────────────────
// Search highlight dispatch
// ──────────────────────────────────────────────────────────────

/**
 * Dispatch search highlight effects to the CodeMirror view for a given buffer.
 *
 * Matches carry absolute UTF-8 byte offsets from the Rust rope.  We subtract
 * the window's `start` byte offset to make them relative to the CM document,
 * then convert from bytes to CM char positions.
 *
 * When the currently active match (currentIdx) falls outside the loaded
 * virtual-document window, jumpToWindow is called first to slide the window
 * to cover that line – WITHOUT loading the entire file into CM.
 */
export async function highlightSearchMatches(
  bufferId: number,
  matches: SearchMatch[],
  currentIdx: number,
  noScroll?: boolean,
): Promise<void> {
  const view = registry.get(bufferId);
  if (!view) return;

  // If the active match is outside the current window, slide the window to it.
  // Skip when noScroll is set (e.g. after Replace All) to keep the user's viewport stable.
  const currentMatch = currentIdx >= 0 ? matches[currentIdx] : null;
  if (currentMatch && !noScroll) {
    const winRange = windowRangeMap.get(bufferId);
    const winStart = winRange?.start ?? 0;
    const winEnd = winRange?.end ?? new TextEncoder().encode(view.state.doc.toString()).length;
    if (currentMatch.from < winStart || currentMatch.from >= winEnd) {
      const jumpFn = jumpRegistry.get(bufferId);
      if (jumpFn) {
        await jumpFn(currentMatch.line);
      }
    }
  }

  // Re-read window range after potential jump.
  const winRange = windowRangeMap.get(bufferId);
  const winStart = winRange?.start ?? 0;

  const docText = view.state.doc.toString();
  const docByteLen = new TextEncoder().encode(docText).length;
  const winEnd = winStart + docByteLen;

  // Binary-search for the first match whose `from` >= winStart.
  // Matches are sorted by `from` (Rust regex produces ordered results).
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (matches[mid].from < winStart) lo = mid + 1;
    else hi = mid;
  }

  const allOffsets: number[] = [];
  const inWindowIndices: number[] = [];
  for (let i = lo; i < matches.length; i++) {
    const m = matches[i];
    if (m.from >= winEnd) break;
    const relFrom = m.from - winStart;
    const relTo = m.to - winStart;
    allOffsets.push(relFrom, Math.min(relTo, docByteLen));
    inWindowIndices.push(i);
  }
  const offsetMap = byteOffsetsToCharOffsets(docText, allOffsets);

  const cmMatches: Array<{ from: number; to: number }> = [];
  let cmCurrentIdx = -1;
  for (const origIdx of inWindowIndices) {
    const m = matches[origIdx];
    const relFrom = m.from - winStart;
    const relTo = m.to - winStart;
    const from = offsetMap.get(relFrom) ?? 0;
    const to = offsetMap.get(Math.min(relTo, docByteLen)) ?? from;
    const cmIdx = cmMatches.length;
    cmMatches.push({ from, to });
    if (origIdx === currentIdx) cmCurrentIdx = cmIdx;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effects: any[] = [
    setMatchRanges.of(cmMatches),
    setCurrentMatch.of(cmCurrentIdx),
  ];
  if (cmCurrentIdx >= 0 && cmMatches[cmCurrentIdx] && !noScroll) {
    effects.push(EditorView.scrollIntoView(cmMatches[cmCurrentIdx].from, { y: 'center' }));
  }
  view.dispatch({ effects });
}

// ──────────────────────────────────────────────────────────────
// In-CM replacement (undoable via Ctrl+Z)
// ──────────────────────────────────────────────────────────────

/**
 * Apply a single replacement directly as a CodeMirror transaction so that it
 * enters the undo history and can be reverted with Ctrl+Z.
 *
 * `fromByte` / `toByte` are absolute UTF-8 byte offsets in the Rust rope
 * (same coordinate space as SearchMatch.from / .to).
 *
 * Returns true when the match falls inside the current virtual-document window
 * and the transaction was dispatched.  Returns false when the match is outside
 * the window; the caller should fall back to the Rust-side replace + reload.
 */
export function applyReplaceEditToCM(
  bufferId: number,
  fromByte: number,
  toByte: number,
  replacement: string,
): boolean {
  const view = registry.get(bufferId);
  if (!view) return false;

  const winRange = windowRangeMap.get(bufferId);
  const winStart = winRange?.start ?? 0;
  const docText = view.state.doc.toString();
  const docByteLen = new TextEncoder().encode(docText).length;
  const winEnd = winRange?.end ?? (winStart + docByteLen);

  // Reject if the match is outside the currently loaded window.
  if (fromByte < winStart || fromByte >= winEnd) return false;

  const relFrom = fromByte - winStart;
  const relTo = Math.min(toByte - winStart, docByteLen);
  const charMap = byteOffsetsToCharOffsets(docText, [relFrom, relTo]);
  const cmFrom = charMap.get(relFrom);
  const cmTo = charMap.get(relTo);
  if (cmFrom === undefined || cmTo === undefined) return false;

  // Dispatch as a normal (history-tracked) transaction — NOT virtualLoad.
  view.dispatch({ changes: { from: cmFrom, to: cmTo, insert: replacement } });
  return true;
}

// ──────────────────────────────────────────────────────────────
// Sync CM → Rust
// ──────────────────────────────────────────────────────────────

/**
 * Reads the current CodeMirror document for the given bufferId and
 * replaces the corresponding byte range in the Rust rope via apply_edit.
 *
 * - When the window starts at byte 0 (normal scrolling from top), the entire
 *   rope is replaced (same as before).
 * - When the window was shifted by a search jump (windowStart > 0), only the
 *   window's original byte range is replaced, so content before/after the
 *   window is preserved.
 *
 * Skipped entirely when no user text edits have occurred since the last sync.
 */
export async function syncEditorToRust(bufferId: number): Promise<void> {
  if (!textEditedBuffers.has(bufferId)) return;

  const view = registry.get(bufferId);
  if (!view) return;

  const text = view.state.doc.toString();
  const winRange = windowRangeMap.get(bufferId);

  if (!winRange || winRange.start === 0) {
    // Window anchored at file start → replace everything.
    await applyEdit(bufferId, { from: 0, to: Number.MAX_SAFE_INTEGER, text });
  } else {
    // Windowed mode: replace only the original byte range of this window.
    // winRange.end is the Rust-side exclusive end byte BEFORE any CM edits,
    // so it correctly targets the original rope content to replace.
    await applyEdit(bufferId, { from: winRange.start, to: winRange.end, text });
  }

  textEditedBuffers.delete(bufferId);
}
