import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { atxHeadingText } from './markdownLinkParse';
import type { FoundLink } from './markdownLinkParse';
import { linkAtPoint } from './markdownLinkHit';
import { markdownLinkHoverExtension } from './markdownLinkHover';
import { headingMatches } from '../utils/linkTarget';
import type { LinkTarget } from '../utils/linkTarget';

export interface MarkdownLinkClickHandlers {
  /** An external URL or a note / relative file link was Ctrl+clicked. */
  openLink: (link: Extract<LinkTarget, { kind: 'external' | 'note' }>) => void;
  /** A same-document heading link matched no heading in the loaded CodeMirror window. */
  anchorMissing: (heading: string) => void;
}

function isModClick(e: MouseEvent): boolean {
  return e.button === 0 && (e.ctrlKey || e.metaKey);
}

function linkAtEvent(view: EditorView, e: MouseEvent): FoundLink | null {
  return linkAtPoint(view, e.clientX, e.clientY);
}

/**
 * Moves the cursor to a heading inside the CURRENTLY LOADED window (virtual doc: the heading
 * may live outside it, in which case this returns false).
 */
function scrollToHeading(view: EditorView, heading: string): boolean {
  let pos = 0;
  for (const text of view.state.doc.iterLines()) {
    const title = atxHeadingText(text);
    if (title !== null && headingMatches(title, heading)) {
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
      });
      return true;
    }
    pos += text.length + 1;
  }
  return false;
}

/**
 * Markdown-only: Ctrl/Cmd+click on `[text](url)`, `[[wikilink]]` or a bare URL.
 * - `http(s)` / `mailto` -> OS default handler; notes / relative files -> opened in Power Editor.
 * - `#heading` -> jump within the loaded window.
 *
 * `mousedown` only claims the gesture (blocks selection start / column-mode extra cursors);
 * the action fires on `click`, and only if the link under the pointer is the one that was
 * pressed, so Ctrl+drag never triggers navigation. Non-link clicks are left to CodeMirror.
 */
export function markdownLinkClickExtension(
  getHandlers: () => MarkdownLinkClickHandlers,
): Extension {
  let pressed: FoundLink | null = null;

  const clickHandlers = EditorView.domEventHandlers({
    mousedown(e: MouseEvent, view: EditorView) {
      pressed = null;
      if (!isModClick(e)) return false;
      const hit = linkAtEvent(view, e);
      if (!hit) return false;
      pressed = hit;
      e.preventDefault();
      return true;
    },
    click(e: MouseEvent, view: EditorView) {
      const down = pressed;
      pressed = null;
      if (!down || !isModClick(e)) return false;

      const hit = linkAtEvent(view, e);
      if (!hit || hit.from !== down.from || hit.to !== down.to) return false;

      e.preventDefault();
      const { link } = hit;
      if (link.kind === 'anchor') {
        if (!scrollToHeading(view, link.heading)) getHandlers().anchorMissing(link.heading);
      } else {
        getHandlers().openLink(link);
      }
      return true;
    },
  });

  // Hand cursor + underline while Ctrl/Cmd is held over a link (the click affordance).
  return [clickHandlers, markdownLinkHoverExtension()];
}
