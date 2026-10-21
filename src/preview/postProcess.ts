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

const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

export interface PostProcessCodeOptions {
  copyTitle?: string;
  copiedTitle?: string;
}

/**
 * Asynchronously highlights fenced code blocks using CodeMirror language packs
 * and Lezer classHighlighter, and wraps code blocks with a clean container
 * containing an optional language badge and a copy-to-clipboard button.
 */
export async function postProcessCodeBlocks(
  container: HTMLElement,
  options?: PostProcessCodeOptions
): Promise<void> {
  const copyTitle = options?.copyTitle || 'Copy code';
  const copiedTitle = options?.copiedTitle || 'Copied!';

  const preNodes = container.querySelectorAll<HTMLPreElement>('pre');

  for (const pre of Array.from(preNodes)) {
    const code = pre.querySelector('code');
    const className = code?.className || '';
    const match = className.match(/language-([a-zA-Z0-9_+-]+)/);
    const langName = match ? match[1] : '';

    // Check if pre is already wrapped in .codeBlockContainer
    let wrapper = pre.parentElement?.classList.contains('codeBlockContainer')
      ? pre.parentElement
      : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'codeBlockContainer';

      // Transfer data-line to wrapper for scroll synchronization
      const dataLine = pre.getAttribute('data-line');
      if (dataLine) {
        wrapper.setAttribute('data-line', dataLine);
      }

      // Action toolbar: language badge + copy button
      const actions = document.createElement('div');
      actions.className = 'codeBlockActions';

      if (langName) {
        const badge = document.createElement('span');
        badge.className = 'codeLangBadge';
        badge.textContent = langName;
        actions.appendChild(badge);
      }

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'codeCopyBtn';
      copyBtn.title = copyTitle;
      copyBtn.setAttribute('aria-label', copyTitle);
      copyBtn.innerHTML = COPY_ICON_SVG;

      let revertTimer: ReturnType<typeof setTimeout> | null = null;
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const rawText = code ? code.textContent || '' : pre.textContent || '';
        try {
          await navigator.clipboard.writeText(rawText);
          copyBtn.innerHTML = CHECK_ICON_SVG;
          copyBtn.classList.add('copied');
          copyBtn.title = copiedTitle;
          copyBtn.setAttribute('aria-label', copiedTitle);

          if (revertTimer) clearTimeout(revertTimer);
          revertTimer = setTimeout(() => {
            copyBtn.innerHTML = COPY_ICON_SVG;
            copyBtn.classList.remove('copied');
            copyBtn.title = copyTitle;
            copyBtn.setAttribute('aria-label', copyTitle);
            revertTimer = null;
          }, 2000);
        } catch (err) {
          console.warn('[preview] Failed to copy code to clipboard:', err);
        }
      });

      actions.appendChild(copyBtn);

      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(actions);
      wrapper.appendChild(pre);
    } else {
      // Wrapper exists, refresh tooltip text if updated
      const existingBtn = wrapper.querySelector<HTMLButtonElement>('.codeCopyBtn');
      if (existingBtn && !existingBtn.classList.contains('copied')) {
        existingBtn.title = copyTitle;
        existingBtn.setAttribute('aria-label', copyTitle);
      }
    }

    // Highlight code syntax if language is recognized and not already highlighted
    if (code && langName && !code.dataset.highlighted) {
      const desc = findLanguageDescription(langName);
      if (desc) {
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
          code.dataset.highlighted = 'true';
        } catch (err) {
          console.warn(`[preview] Failed to highlight code block (${langName}):`, err);
        }
      }
    }
  }
}
