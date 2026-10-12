import { loadFullText } from '../utils/loadFullText';
import { renderMarkdown } from '../preview/renderMarkdown';
import { postProcessImages, postProcessCodeBlocks } from '../preview/postProcess';
import { printWindow } from '../store/tauriCommands';
import type { ActiveSelection } from './selectionHelper';

export const PRINT_PLAIN_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const PRINT_LINENO_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

export type PrintResult =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'loading' | 'empty' | 'error' };

export interface PrintOptions {
  bufferId: number;
  filePath: string | null;
  fileName: string;
  isMarkdown: boolean;
  totalBytes: number;
  isFullyLoaded: boolean;
  lineNumbers: boolean;
  selection?: ActiveSelection;
}

/**
 * Triggers native system printing across platforms:
 * - macOS: tries Tauri's native WebviewWindow print API (WKWebView), with fallback to window.print()
 * - Windows / Linux: window.print() via system webview (WebView2 / WebKitGTK)
 */
async function triggerPrint(): Promise<void> {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
  if (isMac) {
    try {
      await printWindow();
      return;
    } catch (err) {
      console.warn('[print] Native print invocation failed on macOS, falling back to window.print():', err);
    }
  }
  window.print();
}

/**
 * Waits for all img elements in container to finish loading, with a safety timeout.
 */
async function waitForImages(container: HTMLElement, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  if (imgs.length === 0) return;

  const promises = imgs.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    });
  });

  await Promise.race([
    Promise.all(promises),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Prepares and opens the native print dialog for the given tab document.
 */
export async function printTab(opts: PrintOptions): Promise<PrintResult> {
  const {
    bufferId,
    filePath,
    fileName,
    isMarkdown,
    totalBytes,
    isFullyLoaded,
    lineNumbers,
    selection,
  } = opts;

  if (bufferId < 0) {
    return { ok: false, reason: 'empty' };
  }

  // Remove existing print container if any
  const existing = document.getElementById('print-root');
  if (existing) {
    existing.remove();
  }

  const printRoot = document.createElement('div');
  printRoot.id = 'print-root';

  const isSelection = selection && selection.type !== 'none';

  if (selection && selection.type === 'preview') {
    // ── Preview Selection Mode (Formatted HTML) ──
    const bodyEl = document.createElement('div');
    bodyEl.className = 'markdown-body';
    bodyEl.innerHTML = selection.html;

    postProcessImages(bodyEl, filePath);
    await postProcessCodeBlocks(bodyEl);
    await waitForImages(bodyEl);

    printRoot.appendChild(bodyEl);
  } else if (selection && selection.type === 'editor') {
    // ── Editor Selection Mode (Monospace Plain Text / Markdown Source) ──
    const text = selection.text;
    if (!text.trim()) {
      return { ok: false, reason: 'empty' };
    }

    if (lineNumbers) {
      const lines = text.split(/\r?\n/);
      const table = document.createElement('div');
      table.className = 'print-plain print-plain-table';

      let html = '';
      for (let i = 0; i < lines.length; i++) {
        const lineNo = selection.startLine + i;
        const lineContent = escapeHtml(lines[i]) || '&nbsp;';
        html += `<div class="print-line-row"><span class="print-line-no">${lineNo}</span><span class="print-line-text">${lineContent}</span></div>`;
      }
      table.innerHTML = html;
      printRoot.appendChild(table);
    } else {
      const pre = document.createElement('pre');
      pre.className = 'print-plain';
      pre.textContent = text;
      printRoot.appendChild(pre);
    }
  } else {
    // ── Full Document Mode ──
    if (!isFullyLoaded) {
      return { ok: false, reason: 'loading' };
    }

    if (!isMarkdown && totalBytes > PRINT_PLAIN_MAX_BYTES) {
      return { ok: false, reason: 'too_large' };
    }

    const text = await loadFullText(bufferId);
    if (!text || !text.trim()) {
      return { ok: false, reason: 'empty' };
    }

    if (isMarkdown) {
      const rendered = renderMarkdown(text);
      const bodyEl = document.createElement('div');
      bodyEl.className = 'markdown-body';
      bodyEl.innerHTML = rendered.html;

      postProcessImages(bodyEl, filePath);
      await postProcessCodeBlocks(bodyEl);
      await waitForImages(bodyEl);

      printRoot.appendChild(bodyEl);
    } else {
      const enableLines = lineNumbers && totalBytes <= PRINT_LINENO_MAX_BYTES;

      if (enableLines) {
        const lines = text.split(/\r?\n/);
        const table = document.createElement('div');
        table.className = 'print-plain print-plain-table';

        let html = '';
        for (let i = 0; i < lines.length; i++) {
          const lineNo = i + 1;
          const lineContent = escapeHtml(lines[i]) || '&nbsp;';
          html += `<div class="print-line-row"><span class="print-line-no">${lineNo}</span><span class="print-line-text">${lineContent}</span></div>`;
        }
        table.innerHTML = html;
        printRoot.appendChild(table);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'print-plain';
        pre.textContent = text;
        printRoot.appendChild(pre);
      }
    }
  }

  document.body.appendChild(printRoot);

  const originalTitle = document.title;
  if (fileName) {
    const isZh = document.documentElement.lang?.startsWith('zh');
    const suffix = isSelection ? (isZh ? ' (选区)' : ' (Selection)') : '';
    document.title = fileName + suffix;
  }

  document.body.classList.add('is-printing');

  const cleanup = () => {
    document.body.classList.remove('is-printing');
    document.title = originalTitle;
    printRoot.remove();
    window.removeEventListener('afterprint', onAfterPrint);
  };

  const onAfterPrint = () => {
    cleanup();
  };

  window.addEventListener('afterprint', onAfterPrint);

  // Fallback cleanup in case afterprint doesn't fire
  setTimeout(() => {
    if (document.body.contains(printRoot)) {
      cleanup();
    }
  }, 120000);

  // Wait two animation frames for layout calculation before invoking print dialog
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  try {
    await triggerPrint();
    return { ok: true };
  } catch (err) {
    console.error('[printTab] Printing execution failed:', err);
    cleanup();
    return { ok: false, reason: 'error' };
  }
}
