import type { KeyBinding } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

/**
 * Scan from right to left to find the rightmost unclosed opening bracket
 * among '(', '[', '{'. Returns -1 if all brackets are balanced/closed.
 */
function findLastUnclosedBracket(line: string): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let maxIdx = -1;

  for (const [open, close] of Object.entries(pairs)) {
    let depth = 0;
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i] === close) {
        depth++;
      } else if (line[i] === open) {
        if (depth === 0) {
          // This open bracket has no matching close bracket after it
          maxIdx = Math.max(maxIdx, i);
          break;
        }
        depth--;
      }
    }
  }

  return maxIdx;
}

/**
 * Returns true for Unicode code points that are rendered as double-width
 * (full-width / CJK) in a monospace font, matching the East Asian Width
 * "W" and "F" categories used by most editors and terminals.
 */
function isDoubleWidth(cp: number): boolean {
  return (
    (cp >= 0x1100  && cp <= 0x115F)  ||  // Hangul Jamo
    (cp >= 0x2E80  && cp <= 0x303E)  ||  // CJK Radicals … CJK Symbols
    (cp >= 0x3040  && cp <= 0x33FF)  ||  // Hiragana … CJK Compatibility
    (cp >= 0x3400  && cp <= 0x4DBF)  ||  // CJK Extension A
    (cp >= 0x4E00  && cp <= 0xA4C6)  ||  // CJK Unified Ideographs
    (cp >= 0xA960  && cp <= 0xA97C)  ||  // Hangul Jamo Extended-A
    (cp >= 0xAC00  && cp <= 0xD7A3)  ||  // Hangul Syllables
    (cp >= 0xF900  && cp <= 0xFAFF)  ||  // CJK Compatibility Ideographs
    (cp >= 0xFE10  && cp <= 0xFE19)  ||  // Vertical Forms
    (cp >= 0xFE30  && cp <= 0xFE6B)  ||  // CJK Compatibility Forms
    (cp >= 0xFF01  && cp <= 0xFF60)  ||  // Fullwidth ASCII
    (cp >= 0xFFE0  && cp <= 0xFFE6)  ||  // Fullwidth Signs
    (cp >= 0x1B000 && cp <= 0x1B001) ||  // Kana Supplement
    (cp >= 0x1F200 && cp <= 0x1F251) ||  // Enclosed Ideographic Supplement
    (cp >= 0x20000 && cp <= 0x3FFFD)     // CJK Extension B–F and beyond
  );
}

/**
 * Compute the visual column at position `upToPos` (exclusive), accounting
 * for tab stops and double-width characters (CJK, full-width, etc.).
 */
function visualColumn(text: string, upToPos: number, tabSize: number): number {
  let col = 0;
  let i = 0;
  while (i < upToPos) {
    const cp = text.codePointAt(i) ?? text.charCodeAt(i);
    const codeUnitLen = cp > 0xFFFF ? 2 : 1;  // surrogate pair occupies 2 JS chars
    if (text[i] === '\t') {
      col += tabSize - (col % tabSize);
    } else if (isDoubleWidth(cp)) {
      col += 2;
    } else {
      col += 1;
    }
    i += codeUnitLen;
  }
  return col;
}

/**
 * Enter key binding with smart indentation:
 * - If the current line has an unclosed '(', '[', or '{', align after the
 *   rightmost such bracket (using visual column to handle tabs correctly).
 * - Otherwise, align with the leading whitespace of the current line.
 */
export const smartEnterKey: KeyBinding = {
  key: 'Enter',
  run: (view: EditorView): boolean => {
    const { state } = view;
    const { from } = state.selection.main;
    const lineText = state.doc.lineAt(from).text;
    const tabSize = state.tabSize;

    const lastUnclosed = findLastUnclosedBracket(lineText);

    const indent = lastUnclosed !== -1
      ? ' '.repeat(visualColumn(lineText, lastUnclosed + 1, tabSize))
      : (lineText.match(/^(\s*)/)?.[1] ?? '');

    view.dispatch({
      ...state.replaceSelection('\n' + indent),
      scrollIntoView: true,
    });
    return true;
  },
};
