import { Annotation } from '@codemirror/state';

/**
 * Marks a CodeMirror transaction as a virtual "load from Rust" operation,
 * not a user text edit. Used to distinguish virtual loads from real edits
 * so that syncEditorToRust can skip syncing when no actual edits were made.
 */
export const virtualLoad = Annotation.define<boolean>();
