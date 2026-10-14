import type { EditorView } from '@codemirror/view';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

/** Menu open state: pointer position plus the view that was right-clicked. */
export interface ContextMenuState extends ContextMenuPosition {
  view: EditorView;
}

export interface EditorContextMenuItem {
  id?: string;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Skip returning focus to the editor after the item runs (e.g. Find opens its own input). */
  keepFocus?: boolean;
  onClick?: () => void;
}
