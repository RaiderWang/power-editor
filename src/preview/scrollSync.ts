import type { EditorView } from '@codemirror/view';

/**
 * Sets up editor-to-preview scroll synchronization.
 * Measures CodeMirror top visible line and maps it to preview elements with data-line attributes.
 */
export function setupScrollSync(
  view: EditorView,
  previewEl: HTMLElement,
  isEnabled: () => boolean
): () => void {
  let rafId: number | null = null;

  const onScroll = () => {
    if (!isEnabled()) return;
    if (rafId !== null) return;

    rafId = requestAnimationFrame(() => {
      rafId = null;
      syncPosition();
    });
  };

  const syncPosition = () => {
    try {
      const scrollDOM = view.scrollDOM;
      const scrollTop = scrollDOM.scrollTop;
      const scrollHeight = scrollDOM.scrollHeight;
      const clientHeight = scrollDOM.clientHeight;

      // Handle extreme top & bottom boundaries
      if (scrollTop <= 2) {
        previewEl.scrollTop = 0;
        return;
      }
      if (scrollTop + clientHeight >= scrollHeight - 5) {
        previewEl.scrollTop = previewEl.scrollHeight - previewEl.clientHeight;
        return;
      }

      // Find top visible line in CodeMirror
      const lineBlock = view.lineBlockAtHeight(scrollTop);
      const editorLine = view.state.doc.lineAt(lineBlock.from).number;

      // Find elements with data-line in the preview pane
      const lineElements = Array.from(
        previewEl.querySelectorAll<HTMLElement>('[data-line]')
      );
      if (lineElements.length === 0) return;

      let prevEl: HTMLElement | null = null;
      let nextEl: HTMLElement | null = null;
      let prevLine = 0;
      let nextLine = 0;

      for (const el of lineElements) {
        const lineAttr = el.getAttribute('data-line');
        if (!lineAttr) continue;
        const lineNum = parseInt(lineAttr, 10);
        if (isNaN(lineNum)) continue;

        if (lineNum <= editorLine) {
          prevEl = el;
          prevLine = lineNum;
        } else {
          nextEl = el;
          nextLine = lineNum;
          break;
        }
      }

      if (!prevEl) {
        previewEl.scrollTop = 0;
        return;
      }
      if (!nextEl) {
        previewEl.scrollTop = prevEl.offsetTop;
        return;
      }

      const fraction = nextLine > prevLine ? (editorLine - prevLine) / (nextLine - prevLine) : 0;
      const targetTop = prevEl.offsetTop + fraction * (nextEl.offsetTop - prevEl.offsetTop);
      previewEl.scrollTop = targetTop;
    } catch {
      // Ignore layout errors during CodeMirror reconfiguration
    }
  };

  const scroller = view.scrollDOM;
  scroller.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    scroller.removeEventListener('scroll', onScroll);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  };
}
