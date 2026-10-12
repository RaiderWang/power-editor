import { getEditorView } from '../store/previewBridge';

export type ActiveSelection =
  | { type: 'preview'; html: string; text: string }
  | { type: 'editor'; text: string; startLine: number }
  | { type: 'none' };

interface CachedPreviewSelection {
  html: string;
  text: string;
  timestamp: number;
}

let cachedPreviewSel: CachedPreviewSelection | null = null;
let lastEditorFocusTime = 0;

/**
 * Updates the cached preview selection.
 * Called by MarkdownPreviewPane on mouseup / selectionchange.
 */
export function setCachedPreviewSelection(sel: { html: string; text: string } | null): void {
  if (!sel || !sel.text.trim()) {
    cachedPreviewSel = null;
  } else {
    cachedPreviewSel = {
      html: sel.html,
      text: sel.text,
      timestamp: Date.now(),
    };
  }
}

/**
 * Record editor interaction timestamp to help resolve focus ambiguity.
 */
export function notifyEditorFocused(): void {
  lastEditorFocusTime = Date.now();
}

/**
 * Inspects current DOM Selection to see if active selection is inside the preview pane.
 */
function getLivePreviewSelection(): { html: string; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return null;
  }

  const range = sel.getRangeAt(0);
  const previewContainer = document.querySelector('[data-preview-container="true"]');
  if (!previewContainer) {
    return null;
  }

  // Check if selection starts or ends or is contained inside preview container
  if (
    previewContainer.contains(range.commonAncestorContainer) ||
    previewContainer.contains(sel.anchorNode) ||
    previewContainer.contains(sel.focusNode)
  ) {
    const text = sel.toString();
    if (!text.trim()) return null;

    const wrapper = document.createElement('div');
    wrapper.appendChild(range.cloneContents());
    return {
      html: wrapper.innerHTML,
      text,
    };
  }

  return null;
}

/**
 * Determines the active selection for printing.
 * Priority:
 * 1. Live DOM selection inside the Markdown Preview Pane.
 * 2. Editor selection if editor has focus and non-empty range.
 * 3. Cached Preview selection (handles blur when user clicks MenuBar).
 * 4. Editor selection if non-empty (even without focus, if no preview selection).
 * 5. None.
 */
export function getActiveSelection(bufferId: number): ActiveSelection {
  // 1. Check live preview selection
  const livePreview = getLivePreviewSelection();
  if (livePreview) {
    return {
      type: 'preview',
      html: livePreview.html,
      text: livePreview.text,
    };
  }

  // 2. Check editor selection
  const view = getEditorView(bufferId);
  const editorSel = view ? view.state.selection.main : null;
  const hasEditorSelection = editorSel ? !editorSel.empty : false;

  const editorHasFocus = view ? view.hasFocus : false;
  if (hasEditorSelection && view && editorSel) {
    // If editor has focus, editor selection takes precedence
    if (editorHasFocus) {
      const text = view.state.sliceDoc(editorSel.from, editorSel.to);
      const startLine = view.state.doc.lineAt(editorSel.from).number;
      return { type: 'editor', text, startLine };
    }
  }

  // 3. Check cached preview selection (valid within 5 seconds and after editor focus)
  if (cachedPreviewSel) {
    const isRecent = Date.now() - cachedPreviewSel.timestamp < 5000;
    const isAfterEditorFocus = cachedPreviewSel.timestamp >= lastEditorFocusTime;
    if (isRecent && isAfterEditorFocus) {
      return {
        type: 'preview',
        html: cachedPreviewSel.html,
        text: cachedPreviewSel.text,
      };
    }
  }

  // 4. Fallback to editor selection if present
  if (hasEditorSelection && view && editorSel) {
    const text = view.state.sliceDoc(editorSel.from, editorSel.to);
    const startLine = view.state.doc.lineAt(editorSel.from).number;
    return { type: 'editor', text, startLine };
  }

  return { type: 'none' };
}
