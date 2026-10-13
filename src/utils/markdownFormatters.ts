import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Wraps or toggles inline markdown formatting (e.g. bold, italic, strikethrough, inline code).
 * If text is selected, wraps the selection with prefix & suffix (or unwraps if already wrapped).
 * If no text is selected, inserts prefix + placeholder + suffix and selects the placeholder.
 */
export function wrapInline(
  view: EditorView,
  prefix: string,
  suffix: string,
  placeholder = 'text'
): void {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    if (range.empty) {
      const insertText = `${prefix}${placeholder}${suffix}`;
      return {
        changes: [{ from: range.from, insert: insertText }],
        range: EditorSelection.range(
          range.from + prefix.length,
          range.from + prefix.length + placeholder.length
        ),
      };
    }

    const selectedText = state.sliceDoc(range.from, range.to);

    // If selection itself starts with prefix and ends with suffix, unwrap it (toggle off)
    if (
      selectedText.startsWith(prefix) &&
      selectedText.endsWith(suffix) &&
      selectedText.length >= prefix.length + suffix.length
    ) {
      const unwrapped = selectedText.slice(prefix.length, selectedText.length - suffix.length);
      return {
        changes: [{ from: range.from, to: range.to, insert: unwrapped }],
        range: EditorSelection.range(range.from, range.from + unwrapped.length),
      };
    }

    // Check if the characters directly outside the selection match prefix & suffix
    const beforeStart = Math.max(0, range.from - prefix.length);
    const afterEnd = Math.min(state.doc.length, range.to + suffix.length);
    const textBefore = state.sliceDoc(beforeStart, range.from);
    const textAfter = state.sliceDoc(range.to, afterEnd);

    if (textBefore === prefix && textAfter === suffix) {
      // Unwrap outer markers
      return {
        changes: [
          { from: beforeStart, to: range.from, insert: '' },
          { from: range.to, to: afterEnd, insert: '' },
        ],
        range: EditorSelection.range(beforeStart, beforeStart + selectedText.length),
      };
    }

    // Wrap the selected text
    const wrapped = `${prefix}${selectedText}${suffix}`;
    return {
      changes: [{ from: range.from, to: range.to, insert: wrapped }],
      range: EditorSelection.range(range.from, range.from + wrapped.length),
    };
  });

  view.dispatch(changes);
  view.focus();
}

/**
 * Apply or toggle a Markdown heading level (1 to 6) to the lines touched by selection.
 * If the current line already has the same heading level, it removes it.
 */
export function applyHeading(view: EditorView, level: number): void {
  const targetPrefix = level > 0 ? `${'#'.repeat(level)} ` : '';
  const headingRegex = /^#{1,6}\s+/;

  const lineRanges = getUniqueLinesForSelection(view);
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const { from, text } of lineRanges) {
    const match = text.match(headingRegex);
    if (match) {
      const currentLevel = match[0].trim().length;
      if (currentLevel === level) {
        // Toggle off heading
        changes.push({ from, to: from + match[0].length, insert: '' });
      } else {
        // Replace heading level
        changes.push({ from, to: from + match[0].length, insert: targetPrefix });
      }
    } else if (level > 0) {
      // Add heading prefix
      changes.push({ from, to: from, insert: targetPrefix });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

export type LineListType = 'bullet' | 'number' | 'task' | 'quote';

/**
 * Toggle block-level line prefixes (bullet list, numbered list, task list, quote).
 */
export function toggleLinePrefix(view: EditorView, type: LineListType): void {
  const lineRanges = getUniqueLinesForSelection(view);

  const prefixPatternMap: Record<LineListType, RegExp> = {
    bullet: /^[-*+]\s+/,
    number: /^\d+\.\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };

  const pattern = prefixPatternMap[type];

  // Check if ALL selected lines already have this prefix
  const allHavePrefix = lineRanges.length > 0 && lineRanges.every((l) => pattern.test(l.text));

  const changes: { from: number; to: number; insert: string }[] = [];

  lineRanges.forEach(({ from, text }, index) => {
    const existingMatch = text.match(pattern);

    if (allHavePrefix) {
      // Remove the prefix from all lines
      if (existingMatch) {
        changes.push({ from, to: from + existingMatch[0].length, insert: '' });
      }
    } else {
      // Remove any conflicting list prefixes first, then apply the new one
      const anyListMatch = text.match(/^([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>+\s+)/);
      const prefixToInsert =
        type === 'number'
          ? `${index + 1}. `
          : type === 'task'
          ? '- [ ] '
          : type === 'bullet'
          ? '- '
          : '> ';

      if (anyListMatch) {
        changes.push({
          from,
          to: from + anyListMatch[0].length,
          insert: prefixToInsert,
        });
      } else {
        changes.push({
          from,
          to: from,
          insert: prefixToInsert,
        });
      }
    }
  });

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

/**
 * Inserts or wraps selection in a Markdown code block (``` ... ```).
 */
export function insertCodeBlock(view: EditorView): void {
  const { state } = view;
  const { main } = state.selection;
  const selectedText = state.sliceDoc(main.from, main.to);

  if (!main.empty && selectedText.trim().length > 0) {
    const wrapped = `\`\`\`\n${selectedText}\n\`\`\`\n`;
    view.dispatch({
      changes: [{ from: main.from, to: main.to, insert: wrapped }],
      selection: EditorSelection.range(main.from, main.from + wrapped.length),
    });
  } else {
    const codeBlockTemplate = '```\n\n```\n';
    view.dispatch({
      changes: [{ from: main.from, insert: codeBlockTemplate }],
      selection: EditorSelection.cursor(main.from + 4), // place cursor inside block
    });
  }
  view.focus();
}

/**
 * Inserts a horizontal rule (---) on a new line.
 */
export function insertHorizontalRule(view: EditorView): void {
  const { state } = view;
  const { main } = state.selection;
  const curLine = state.doc.lineAt(main.from);

  const isLineEmpty = curLine.text.trim() === '';
  const insertPos = isLineEmpty ? curLine.from : curLine.to;
  const insertText = isLineEmpty ? '---\n' : '\n\n---\n';

  view.dispatch({
    changes: [{ from: insertPos, insert: insertText }],
    selection: EditorSelection.cursor(insertPos + insertText.length),
  });
  view.focus();
}

/**
 * Inserts a Markdown link ([anchor](url)).
 */
export function insertLink(view: EditorView): void {
  const { state } = view;
  const { main } = state.selection;

  if (main.empty) {
    const linkTemplate = '[title](url)';
    view.dispatch({
      changes: [{ from: main.from, insert: linkTemplate }],
      // Select 'url' so the user can easily paste or type the link address
      selection: EditorSelection.range(main.from + 8, main.from + 11),
    });
  } else {
    const selectedText = state.sliceDoc(main.from, main.to);
    const linkTemplate = `[${selectedText}](url)`;
    view.dispatch({
      changes: [{ from: main.from, to: main.to, insert: linkTemplate }],
      selection: EditorSelection.range(
        main.from + selectedText.length + 3,
        main.from + selectedText.length + 6
      ),
    });
  }
  view.focus();
}

/**
 * Inserts a standard 3x3 Markdown table template.
 */
export function insertTable(view: EditorView): void {
  const { state } = view;
  const { main } = state.selection;
  const curLine = state.doc.lineAt(main.from);

  const tableTemplate = [
    '| Header 1 | Header 2 | Header 3 |',
    '| --- | --- | --- |',
    '| Item 1 | Item 2 | Item 3 |',
    '| Item 4 | Item 5 | Item 6 |',
    '',
  ].join('\n');

  const isLineEmpty = curLine.text.trim() === '';
  const insertPos = isLineEmpty ? curLine.from : curLine.to;
  const insertText = isLineEmpty ? tableTemplate : `\n\n${tableTemplate}`;

  view.dispatch({
    changes: [{ from: insertPos, insert: insertText }],
    selection: EditorSelection.cursor(insertPos + 2), // Place cursor in first header cell
  });
  view.focus();
}

/**
 * Helper: retrieves line ranges covered by current selections (avoiding duplicates).
 */
function getUniqueLinesForSelection(view: EditorView) {
  const { state } = view;
  const lineNumbers = new Set<number>();
  const lineDetails: { lineNo: number; from: number; to: number; text: string }[] = [];

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;

    for (let l = startLine; l <= endLine; l++) {
      if (!lineNumbers.has(l)) {
        lineNumbers.add(l);
        const line = state.doc.line(l);
        lineDetails.push({
          lineNo: l,
          from: line.from,
          to: line.to,
          text: line.text,
        });
      }
    }
  }

  return lineDetails.sort((a, b) => a.from - b.from);
}
