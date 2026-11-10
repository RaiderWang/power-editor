import { undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import * as cmd from './tauriCommands';
import {
  getEditorView,
  syncEditorToRust,
  reloadCurrentWindow,
  markSearchStale,
  clearSearchHighlights,
} from './editorViewRegistry';

/**
 * Undo / redo for Replace All.
 *
 * Replace All runs in Rust on the full rope, so CodeMirror's history (which only
 * sees a small window) cannot undo it. Rust keeps an O(1) copy-on-write snapshot of
 * the rope taken right before the replacement; Ctrl+Z / Ctrl+Y fall back to it once
 * CodeMirror's own history has nothing left to undo / redo.
 *
 * Rust stays the source of truth (it returns `null` when the snapshot is gone, e.g.
 * after a later text edit). The hint sets below only avoid pointless IPC — most
 * importantly while Ctrl+Z is held down and CodeMirror's history is exhausted — and
 * drive the enabled state of undo/redo buttons and menu items.
 */
const undoHint = new Set<number>();
const redoHint = new Set<number>();
/** Buffers with an undo/redo step in flight; further requests are swallowed. */
const inFlight = new Set<number>();

/** Call after a successful Replace All that replaced at least one match. */
export function noteReplaceAllDone(bufferId: number): void {
  undoHint.add(bufferId);
  redoHint.delete(bufferId);
}

export function hasReplaceUndo(bufferId: number): boolean {
  return undoHint.has(bufferId);
}

export function hasReplaceRedo(bufferId: number): boolean {
  return redoHint.has(bufferId);
}

/** Drop the hints of a closed buffer. */
export function forgetReplaceUndo(bufferId: number): void {
  undoHint.delete(bufferId);
  redoHint.delete(bufferId);
  inFlight.delete(bufferId);
}

async function runReplaceStep(bufferId: number, kind: 'undo' | 'redo'): Promise<void> {
  const from = kind === 'undo' ? undoHint : redoHint;
  const to = kind === 'undo' ? redoHint : undoHint;
  inFlight.add(bufferId);
  try {
    // Make sure the rope matches the editor before the swap (a typed-then-undone
    // character is a no-op for Rust and keeps the snapshot valid).
    await syncEditorToRust(bufferId);
    const info = await (kind === 'undo' ? cmd.undoReplaceAll(bufferId) : cmd.redoReplaceAll(bufferId));
    if (!info) {
      from.delete(bufferId); // snapshot is gone
      return;
    }
    from.delete(bufferId);
    to.add(bufferId);
    await reloadCurrentWindow(bufferId, { markModified: true });
    // The reload is a virtual load: it does not mark search results stale itself.
    markSearchStale(bufferId);
    clearSearchHighlights(bufferId);
  } catch (err) {
    console.error(`[replaceUndo] ${kind} Replace All failed:`, err);
    from.delete(bufferId);
  } finally {
    inFlight.delete(bufferId);
  }
}

/**
 * Starts the Rust-side step. Returns `true` when the key press was consumed
 * (step started or one is already running), `false` when there is nothing to do.
 */
function startReplaceStep(bufferId: number, kind: 'undo' | 'redo'): boolean {
  const hints = kind === 'undo' ? undoHint : redoHint;
  if (!hints.has(bufferId)) return false; // zero IPC when there is no snapshot
  void runReplaceStep(bufferId, kind);
  return true;
}

/** Undo: CodeMirror history first, then the Replace All snapshot. */
export function undoEditOrReplace(view: EditorView, bufferId: number): boolean {
  if (inFlight.has(bufferId)) return true;
  if (undo(view)) return true;
  return startReplaceStep(bufferId, 'undo');
}

/** Redo: CodeMirror history first, then the undone Replace All snapshot. */
export function redoEditOrReplace(view: EditorView, bufferId: number): boolean {
  if (inFlight.has(bufferId)) return true;
  if (redo(view)) return true;
  return startReplaceStep(bufferId, 'redo');
}

/** Toolbar entry: runs undo against the primary editor of the buffer. */
export function undoEdit(bufferId: number): boolean {
  const view = getEditorView(bufferId);
  return view ? undoEditOrReplace(view, bufferId) : false;
}

/** Toolbar entry: runs redo against the primary editor of the buffer. */
export function redoEdit(bufferId: number): boolean {
  const view = getEditorView(bufferId);
  return view ? redoEditOrReplace(view, bufferId) : false;
}
