/** DOM marker placed on the find/replace panel root (`data-search-panel` in SearchPanel.tsx). */
const SEARCH_PANEL_ATTR = 'data-search-panel';

/**
 * True while keyboard focus is inside the find/replace panel.
 *
 * Implicit "give focus back to the editor" side effects (pane activation, tab switch,
 * dropdown close) must not run while this is true, otherwise they steal focus from the
 * panel right after the user clicked into it. Explicit user intents bypass this guard.
 */
export function isSearchPanelFocused(): boolean {
  const el = document.activeElement;
  return el instanceof Element && el.closest(`[${SEARCH_PANEL_ATTR}]`) !== null;
}
