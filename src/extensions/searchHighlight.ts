/**
 * Decorates search match ranges in the CodeMirror view.
 * Ranges are supplied externally (computed in Rust) so large-file search
 * results can be injected without re-running the search in JS.
 */
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';

// Effect to set the current list of match ranges
export const setMatchRanges = StateEffect.define<Array<{ from: number; to: number }>>({
  map: (ranges, change) =>
    ranges.map((r) => ({
      from: change.mapPos(r.from),
      to: change.mapPos(r.to),
    })),
});

// Effect to mark the current (focused) match
export const setCurrentMatch = StateEffect.define<number>({ map: (v) => v });

const matchMark = Decoration.mark({ class: 'cm-search-match' });
const currentMatchMark = Decoration.mark({ class: 'cm-search-match-current' });

export const searchMatchField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    let currentIdx = -1;
    for (const effect of tr.effects) {
      if (effect.is(setCurrentMatch)) {
        currentIdx = effect.value;
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(setMatchRanges)) {
        const ranges: Range<Decoration>[] = [];
        effect.value.forEach((r, idx) => {
          if (idx === currentIdx) {
            ranges.push(currentMatchMark.range(r.from, r.to));
          } else {
            ranges.push(matchMark.range(r.from, r.to));
          }
        });
        ranges.sort((a, b) => a.from - b.from);
        deco = Decoration.set(ranges);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const searchHighlightTheme = EditorView.baseTheme({
  '&.cm-editor .cm-search-match': {
    backgroundColor: 'rgba(255, 200, 0, 0.35)',
    borderRadius: '2px',
  },
  '&.cm-editor .cm-search-match-current': {
    backgroundColor: 'rgba(255, 140, 0, 0.65)',
    borderRadius: '2px',
    outline: '1px solid orange',
  },
});
