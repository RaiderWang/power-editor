import type { EditorView } from '@codemirror/view';
import { undo, redo, deleteLine } from '@codemirror/commands';
import { readClipboardText, writeClipboardText } from '../../../utils/clipboard';

/**
 * Checks whether the editor currently has any non-empty text selection.
 */
export function hasSelection(view: EditorView): boolean {
  return view.state.selection.ranges.some((r) => !r.empty);
}

/**
 * Checks whether an undo operation can currently be performed in the editor.
 */
export function canUndo(view: EditorView): boolean {
  return undo({ state: view.state, dispatch: () => {} });
}

/**
 * Checks whether a redo operation can currently be performed in the editor.
 */
export function canRedo(view: EditorView): boolean {
  return redo({ state: view.state, dispatch: () => {} });
}

/**
 * Copies the current selection to the clipboard. If no selection exists,
 * copies the entire current line(s) including trailing newline.
 */
export async function copySelection(view: EditorView): Promise<boolean> {
  const lineBreak = view.state.lineBreak;
  const ranges = view.state.selection.ranges;
  const nonEmpties = ranges.filter((r) => !r.empty);

  let text: string;
  if (nonEmpties.length > 0) {
    text = nonEmpties.map((r) => view.state.sliceDoc(r.from, r.to)).join(lineBreak);
  } else {
    // VSCode / UltraEdit convention: copy current line(s) with trailing linebreak
    const lineNumbers = new Set<number>();
    const lines: string[] = [];
    for (const range of ranges) {
      const line = view.state.doc.lineAt(range.head);
      if (!lineNumbers.has(line.number)) {
        lineNumbers.add(line.number);
        lines.push(line.text);
      }
    }
    text = lines.join(lineBreak) + lineBreak;
  }

  return writeClipboardText(text);
}

/**
 * Cuts the current selection to the clipboard and removes it from document.
 * If no selection exists, copies the entire current line(s) and deletes the line(s).
 */
export async function cutSelection(view: EditorView, isReadOnly?: boolean): Promise<boolean> {
  if (isReadOnly) return false;

  const copied = await copySelection(view);
  if (!copied) return false;

  if (hasSelection(view)) {
    view.dispatch({
      ...view.state.replaceSelection(''),
      scrollIntoView: true,
      userEvent: 'delete.cut',
    });
  } else {
    deleteLine(view);
  }
  return true;
}

/**
 * Transforms the primary selection of the given view to upper or lower case.
 * Operates on the passed view (not the registry) so split panes work correctly.
 */
export function transformSelectionCase(view: EditorView, transform: 'upper' | 'lower'): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const selected = view.state.sliceDoc(from, to);
  const transformed = transform === 'upper' ? selected.toUpperCase() : selected.toLowerCase();
  view.dispatch({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
    userEvent: 'input',
  });
  return true;
}

/**
 * Reads text from system clipboard and inserts it at current selection/cursor.
 */
export async function pasteFromClipboard(view: EditorView, isReadOnly?: boolean): Promise<boolean> {
  if (isReadOnly) return false;

  const text = await readClipboardText();
  if (!text) return false;

  view.dispatch({
    ...view.state.replaceSelection(text),
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
  return true;
}
