import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface ContextMenuCoords {
  x: number;
  y: number;
}

export interface EditorContextMenuOptions {
  onOpen: (coords: ContextMenuCoords, view: EditorView) => void;
}

/**
 * CodeMirror 6 extension that intercepts contextmenu events, suppresses
 * the native WebView2 menu, optionally positions the cursor under the pointer
 * (if not already within an active selection), and notifies the callback.
 */
export function editorContextMenuExtension(options: EditorContextMenuOptions): Extension {
  return EditorView.domEventHandlers({
    contextmenu(e: MouseEvent, view: EditorView) {
      // Dev only: Shift+RightClick falls through to the native menu (Inspect element).
      if (import.meta.env.DEV && e.shiftKey) return false;

      e.preventDefault();
      e.stopPropagation();

      let x = e.clientX;
      let y = e.clientY;

      // When triggered via keyboard (e.g. Shift+F10 or ContextMenu key),
      // clientX and clientY are typically 0. Position near the cursor head.
      if (x === 0 && y === 0) {
        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        if (coords) {
          x = coords.left;
          y = coords.bottom;
        } else {
          const rect = view.dom.getBoundingClientRect();
          x = rect.left + 20;
          y = rect.top + 20;
        }
      } else {
        // Mouse click: if not inside current non-empty selection, move cursor to clicked position
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos !== null) {
          const insideSelection = view.state.selection.ranges.some(
            (range) => !range.empty && pos >= range.from && pos <= range.to,
          );
          if (!insideSelection) {
            view.dispatch({
              selection: { anchor: pos },
            });
          }
        }
      }

      options.onOpen({ x, y }, view);
      return true;
    },
  });
}
