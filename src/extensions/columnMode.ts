/**
 * Column (block) selection mode for CodeMirror 6.
 * When active, Alt+drag creates a rectangular selection across multiple lines.
 * Uses CM6's built-in rectangularSelection extension.
 */
import { rectangularSelection, crosshairCursor } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

export function columnModeExtension(): Extension {
  return [
    // rectangularSelection creates multiple SelectionRanges (one per line);
    // allowMultipleSelections must be true or CM6 collapses them to a single
    // range (asSingle()), making the selection appear stuck on the start line.
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
  ];
}
