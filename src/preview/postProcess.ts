import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { findLanguageDescription } from '../utils/codeLanguages';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalizes and resolves a relative image path to an absolute path against the document's directory.
 */
function resolveImagePath(src: string, currentFilePath: string | null): string | null {
  if (!src) return null;

  // Don't modify web URLs or data URIs or asset URIs
  if (/^(https?:|data:|asset:|blob:)/i.test(src)) {
    return null;
  }

  // Already absolute Windows or Unix path
  if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(src)) {
    return src;
  }

  if (!currentFilePath) return null;

  const lastSep = Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\'));
  if (lastSep < 0) return null;

  const baseDir = currentFilePath.slice(0, lastSep);
  const cleanSrc = src.replace(/^\.\//, '');
  return `${baseDir}/${cleanSrc}`.replace(/\\/g, '/');
}

/**
 * Rewrites local relative image sources to Tauri's asset protocol.
 */
export function postProcessImages(container: HTMLElement, currentFilePath: string | null): void {
  const images = container.querySelectorAll<HTMLImageElement>('img');
  images.forEach((img) => {
    const rawSrc = img.getAttribute('src');
    if (!rawSrc) return;

    const resolved = resolveImagePath(rawSrc, currentFilePath);
    if (resolved) {
      try {
        img.src = convertFileSrc(resolved);
      } catch (err) {
        console.warn('[preview] convertFileSrc failed for image:', resolved, err);
      }
    }
  });
}

/**
 * Attaches a delegated click handler to intercept links:
 * - Internal hash links (#section) smooth-scroll to the target element.
 * - External http/https/mailto links open via the OS default browser.
 * Returns an unbind cleanup function.
 */
export function setupLinkInterception(container: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const anchor = target.closest<HTMLAnchorElement>('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    if (href.startsWith('#')) {
      e.preventDefault();
      const id = href.slice(1);
      if (!id) return;
      try {
        const el = container.querySelector(`[id="${CSS.escape(id)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      } catch {
        // In case of invalid selector characters
      }
    } else if (/^(https?:|mailto:)/i.test(href)) {
      e.preventDefault();
      openUrl(href).catch((err) => {
        console.error('[preview] Failed to open external URL:', href, err);
      });
    }
  };

  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
  };
}

/**
 * Asynchronously highlights fenced code blocks using CodeMirror language packs
 * and Lezer classHighlighter.
 */
export async function postProcessCodeBlocks(container: HTMLElement): Promise<void> {
  const codeNodes = container.querySelectorAll<HTMLElement>('pre > code');

  for (const code of Array.from(codeNodes)) {
    const className = code.className || '';
    const match = className.match(/language-([a-zA-Z0-9_+-]+)/);
    if (!match) continue;

    const langName = match[1];
    const desc = findLanguageDescription(langName);
    if (!desc) continue;

    try {
      const support = await desc.load();
      const rawText = code.textContent || '';
      const tree = support.language.parser.parse(rawText);

      let highlightedHtml = '';
      highlightCode(
        rawText,
        tree,
        classHighlighter,
        (text, classes) => {
          const esc = escapeHtml(text);
          highlightedHtml += classes ? `<span class="${classes}">${esc}</span>` : esc;
        },
        () => {
          highlightedHtml += '\n';
        }
      );

      code.innerHTML = highlightedHtml;
    } catch (err) {
      console.warn(`[preview] Failed to highlight code block (${langName}):`, err);
    }
  }
}
