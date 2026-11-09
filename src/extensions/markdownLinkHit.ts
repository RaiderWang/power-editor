import type { EditorView } from '@codemirror/view';
import { findLinkAt } from './markdownLinkParse';
import type { FoundLink } from './markdownLinkParse';

/** Characters scanned on each side of the pointer; keeps work O(1) even on minified lines. */
const SCAN_RADIUS = 2000;

/** Finds the Markdown link under screen point (x, y), with absolute document offsets. */
export function linkAtPoint(view: EditorView, x: number, y: number): FoundLink | null {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;

  const line = view.state.doc.lineAt(pos);
  const start = Math.max(line.from, pos - SCAN_RADIUS);
  const end = Math.min(line.to, pos + SCAN_RADIUS);
  const found = findLinkAt(view.state.doc.sliceString(start, end), pos - start);
  if (!found) return null;
  return { from: start + found.from, to: start + found.to, link: found.link };
}
