import { open as openUrl } from '@tauri-apps/plugin-shell';
import { classifyHref, wikiLinkTarget } from '../utils/linkTarget';
import type { LinkTarget } from '../utils/linkTarget';

/** GitHub-style slug used to match `#my-heading` against heading text. */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Scrolls the preview to a heading. Matches an element `id` first, then heading text
 * (case-insensitive) or its GitHub-style slug. marked@18 does not generate heading ids,
 * so text matching is the normal path. Returns whether a target was found.
 */
export function scrollPreviewToHeading(container: HTMLElement, heading: string): boolean {
  const wanted = heading.trim();
  if (!wanted) return false;

  let el: Element | null = null;
  try {
    el = container.querySelector(`[id="${CSS.escape(wanted)}"]`);
  } catch {
    // invalid selector characters
  }

  if (!el) {
    const lower = wanted.toLowerCase();
    const slug = slugify(wanted);
    for (const h of container.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const text = (h.textContent ?? '').trim();
      if (text.toLowerCase() === lower || slugify(text) === slug) {
        el = h;
        break;
      }
    }
  }

  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth' });
  return true;
}

export interface LinkInterceptionHandlers {
  /** A local note/file link was clicked. */
  onNote: (link: Extract<LinkTarget, { kind: 'note' }>) => void;
  /** A same-document heading link did not match any heading in the preview. */
  onAnchorMissing: (heading: string) => void;
}

/** Resolves what an `<a>` element points to (wikilinks carry data attributes, not an href). */
function targetOfAnchor(anchor: HTMLAnchorElement): LinkTarget | null {
  if (anchor.hasAttribute('data-wikilink')) {
    return wikiLinkTarget(
      anchor.getAttribute('data-wikilink') ?? '',
      anchor.getAttribute('data-heading') ?? '',
    );
  }
  const href = anchor.getAttribute('href');
  return href ? classifyHref(href) : null;
}

/**
 * Attaches a delegated click handler to intercept links in the preview:
 * - `#heading` / `[[#heading]]` scroll within the preview.
 * - `http(s):` / `mailto:` open in the OS default handler.
 * - `[[note]]` and relative file links are handed to `handlers.onNote` (opened in Power Editor).
 * - Anything else (unknown protocols, ...) is swallowed.
 * Every click on an `<a>` is `preventDefault`-ed so the WebView never navigates away.
 * `getHandlers` is read on each click so callers can keep handlers in a ref.
 * Returns an unbind cleanup function.
 */
export function setupLinkInterception(
  container: HTMLElement,
  getHandlers: () => LinkInterceptionHandlers,
): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest<HTMLAnchorElement>('a');
    if (!anchor || !container.contains(anchor)) return;

    // Always stop WebView2 from navigating the main window.
    e.preventDefault();

    const link = targetOfAnchor(anchor);
    if (!link) return;

    switch (link.kind) {
      case 'anchor':
        if (!scrollPreviewToHeading(container, link.heading)) {
          getHandlers().onAnchorMissing(link.heading);
        }
        break;
      case 'external':
        openUrl(link.url).catch((err) => {
          console.error('[preview] Failed to open external URL:', link.url, err);
        });
        break;
      case 'note':
        getHandlers().onNote(link);
        break;
    }
  };

  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
  };
}
