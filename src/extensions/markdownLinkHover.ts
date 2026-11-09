import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { linkAtPoint } from './markdownLinkHit';

/** Root class present while Ctrl/Cmd is held over a link: switches the cursor to a hand. */
const HOVER_ROOT_CLASS = 'cm-ctrl-link';

const setHoveredLink = StateEffect.define<{ from: number; to: number } | null>();

const hoverMark = Decoration.mark({ class: 'cm-ctrl-link-mark' });

/** Underline decoration for the link currently under the pointer (at most one range). */
const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    // Edits invalidate the hovered range; the next pointer move recomputes it.
    if (tr.docChanged) deco = Decoration.none;
    for (const effect of tr.effects) {
      if (effect.is(setHoveredLink)) {
        const range = effect.value;
        deco = range ? Decoration.set([hoverMark.range(range.from, range.to)]) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const hoverTheme = EditorView.baseTheme({
  [`&.${HOVER_ROOT_CLASS} .cm-content, &.${HOVER_ROOT_CLASS} .cm-line`]: {
    cursor: 'pointer',
  },
  '.cm-ctrl-link-mark': {
    textDecoration: 'underline',
  },
});

function isModKey(e: KeyboardEvent): boolean {
  return e.key === 'Control' || e.key === 'Meta';
}

/**
 * Tracks the pointer and the Ctrl/Cmd key. Only while the modifier is held does it look up the
 * link under the pointer (O(line window)); otherwise mouse moves cost nothing. Key listeners are
 * on `window` so pressing Ctrl while merely hovering (editor not focused) is detected too.
 */
const hoverPlugin = ViewPlugin.fromClass(
  class {
    private pointer: { x: number; y: number } | null = null;
    private modDown = false;
    private hovered: { from: number; to: number } | null = null;
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener('mousemove', this.onMouseMove);
      view.dom.addEventListener('mouseleave', this.onMouseLeave);
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
      window.addEventListener('blur', this.onBlur);
    }

    update(update: ViewUpdate) {
      // `hoverField` drops its decoration on edits; keep our bookkeeping in sync so the next
      // pointer move re-applies the underline even if it lands on the same range.
      if (update.docChanged && this.hovered) {
        this.hovered = null;
        this.view.dom.classList.remove(HOVER_ROOT_CLASS);
      }
    }

    destroy() {
      this.view.dom.removeEventListener('mousemove', this.onMouseMove);
      this.view.dom.removeEventListener('mouseleave', this.onMouseLeave);
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKey);
      window.removeEventListener('blur', this.onBlur);
      this.view.dom.classList.remove(HOVER_ROOT_CLASS);
    }

    private readonly onMouseMove = (e: MouseEvent) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.modDown = e.ctrlKey || e.metaKey;
      this.refresh();
    };

    private readonly onMouseLeave = () => {
      this.pointer = null;
      this.refresh();
    };

    private readonly onKey = (e: KeyboardEvent) => {
      // Every open Markdown tab has a view listening on `window`; views the pointer never
      // entered (or has left) must stay idle. `modDown` is re-read from the next mousemove.
      if (!this.pointer || !isModKey(e)) return;
      this.modDown = e.type === 'keydown';
      this.refresh();
    };

    private readonly onBlur = () => {
      this.modDown = false;
      this.refresh();
    };

    private refresh() {
      // Inactive tabs stay mounted with `display: none` and never receive `mouseleave`, so their
      // last pointer position goes stale. A hidden view has no layout: drop the pointer (which
      // also clears any lingering hover state below) instead of probing it.
      if (this.pointer && this.view.dom.getClientRects().length === 0) {
        this.pointer = null;
      }

      const hit =
        this.modDown && this.pointer
          ? linkAtPoint(this.view, this.pointer.x, this.pointer.y)
          : null;
      const next = hit ? { from: hit.from, to: hit.to } : null;
      const prev = this.hovered;
      if (prev?.from === next?.from && prev?.to === next?.to) return;

      this.hovered = next;
      this.view.dom.classList.toggle(HOVER_ROOT_CLASS, next !== null);
      this.view.dispatch({ effects: setHoveredLink.of(next) });
    }
  },
);

/** Ctrl/Cmd-hover affordance for Markdown links: hand cursor + underline. */
export function markdownLinkHoverExtension(): Extension {
  return [hoverField, hoverTheme, hoverPlugin];
}
