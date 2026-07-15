import { atom } from 'jotai';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface KeybindingDef {
  id: string;
  /** i18n key for the display label (resolved at render time via t()) */
  labelKey: string;
  category: KeybindingCategory;
  defaultShortcut: string;
  /** false = CM6 built-in, shown read-only */
  editable: boolean;
}

export type KeybindingCategory = 'file' | 'edit' | 'search' | 'view' | 'editor';

/** Maps category id to its i18n key */
export const CATEGORY_LABEL_KEYS: Record<KeybindingCategory, string> = {
  file: 'keybinding.cat.file',
  edit: 'keybinding.cat.edit',
  search: 'keybinding.cat.search',
  view: 'keybinding.cat.view',
  editor: 'keybinding.cat.editor',
};

export interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

// ──────────────────────────────────────────────────────────────
// Default keybinding definitions
// ──────────────────────────────────────────────────────────────

export const DEFAULT_KEYBINDINGS: KeybindingDef[] = [
  { id: 'file.new',       labelKey: 'keybinding.file.new',       category: 'file', defaultShortcut: 'Ctrl+N',       editable: true },
  { id: 'file.open',      labelKey: 'keybinding.file.open',      category: 'file', defaultShortcut: 'Ctrl+O',       editable: true },
  { id: 'file.save',      labelKey: 'keybinding.file.save',      category: 'file', defaultShortcut: 'Ctrl+S',       editable: true },
  { id: 'file.saveAs',    labelKey: 'keybinding.file.saveAs',    category: 'file', defaultShortcut: 'Ctrl+Shift+S', editable: true },
  { id: 'file.closeTab',  labelKey: 'keybinding.file.closeTab',  category: 'file', defaultShortcut: 'Ctrl+W',       editable: true },

  { id: 'edit.deleteLine',  labelKey: 'keybinding.edit.deleteLine',  category: 'edit', defaultShortcut: 'Ctrl+Shift+K', editable: true },
  { id: 'edit.toUpperCase', labelKey: 'keybinding.edit.toUpperCase', category: 'edit', defaultShortcut: 'Ctrl+Shift+U', editable: true },
  { id: 'edit.toLowerCase', labelKey: 'keybinding.edit.toLowerCase', category: 'edit', defaultShortcut: 'Ctrl+U',       editable: true },
  { id: 'edit.copyPath',    labelKey: 'keybinding.edit.copyPath',    category: 'edit', defaultShortcut: '',             editable: true },

  { id: 'search.find',      labelKey: 'keybinding.search.find',      category: 'search', defaultShortcut: 'Ctrl+F',       editable: true },
  { id: 'search.nextMatch', labelKey: 'keybinding.search.nextMatch', category: 'search', defaultShortcut: 'F3',           editable: true },
  { id: 'search.prevMatch', labelKey: 'keybinding.search.prevMatch', category: 'search', defaultShortcut: 'Shift+F3',     editable: true },

  { id: 'view.lineWrap',     labelKey: 'keybinding.view.lineWrap',     category: 'view', defaultShortcut: 'Alt+Z',        editable: true },
  { id: 'view.columnMode',   labelKey: 'keybinding.view.columnMode',   category: 'view', defaultShortcut: 'Alt+C',        editable: true },
  { id: 'view.fontSizeUp',   labelKey: 'keybinding.view.fontSizeUp',   category: 'view', defaultShortcut: 'Ctrl+=',       editable: true },
  { id: 'view.fontSizeDown', labelKey: 'keybinding.view.fontSizeDown', category: 'view', defaultShortcut: 'Ctrl+-',       editable: true },
  { id: 'view.toggleTheme',  labelKey: 'keybinding.view.toggleTheme',  category: 'view', defaultShortcut: '',              editable: true },

  { id: 'editor.undo',      labelKey: 'keybinding.editor.undo',      category: 'editor', defaultShortcut: 'Ctrl+Z',       editable: false },
  { id: 'editor.redo',      labelKey: 'keybinding.editor.redo',      category: 'editor', defaultShortcut: 'Ctrl+Y',       editable: false },
  { id: 'editor.cut',       labelKey: 'keybinding.editor.cut',       category: 'editor', defaultShortcut: 'Ctrl+X',       editable: false },
  { id: 'editor.copy',      labelKey: 'keybinding.editor.copy',      category: 'editor', defaultShortcut: 'Ctrl+C',       editable: false },
  { id: 'editor.paste',     labelKey: 'keybinding.editor.paste',     category: 'editor', defaultShortcut: 'Ctrl+V',       editable: false },
  { id: 'editor.selectAll', labelKey: 'keybinding.editor.selectAll', category: 'editor', defaultShortcut: 'Ctrl+A',       editable: false },
  { id: 'editor.indent',    labelKey: 'keybinding.editor.indent',    category: 'editor', defaultShortcut: 'Tab',           editable: false },
  { id: 'editor.dedent',    labelKey: 'keybinding.editor.dedent',    category: 'editor', defaultShortcut: 'Shift+Tab',     editable: false },
];

export const CATEGORIES: KeybindingCategory[] = ['file', 'edit', 'search', 'view', 'editor'];

// ──────────────────────────────────────────────────────────────
// Shortcut string ⟷ KeyboardEvent utilities
// ──────────────────────────────────────────────────────────────

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  if (!shortcut) return null;
  const parts = shortcut.split('+');
  const result: ParsedShortcut = { ctrl: false, shift: false, alt: false, key: '' };
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'cmd') result.ctrl = true;
    else if (lower === 'shift') result.shift = true;
    else if (lower === 'alt') result.alt = true;
    else result.key = lower;
  }
  return result.key ? result : null;
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  backspace: 'Backspace', delete: 'Delete', escape: 'Esc',
  enter: 'Enter', tab: 'Tab', ' ': 'Space',
  '=': '=', '-': '-', '[': '[', ']': ']',
  '\\': '\\', ';': ';', "'": "'", ',': ',', '.': '.', '/': '/',
  '`': '`',
};

export function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  const key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return '';

  if (key.length === 1 && key >= 'a' && key <= 'z') {
    parts.push(key.toUpperCase());
  } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
    parts.push(key);
  } else if (/^F\d{1,2}$/.test(key)) {
    parts.push(key);
  } else if (KEY_DISPLAY_MAP[key.toLowerCase()]) {
    parts.push(KEY_DISPLAY_MAP[key.toLowerCase()]);
  } else if (key.length === 1) {
    parts.push(key);
  } else {
    parts.push(key);
  }

  return parts.join('+');
}

export function matchesEvent(shortcut: string, e: KeyboardEvent): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;

  const ctrl = e.ctrlKey || e.metaKey;
  if (parsed.ctrl !== ctrl) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  const eventKey = e.key.toLowerCase();
  const targetKey = parsed.key.toLowerCase();

  if (eventKey === targetKey) return true;
  if (/^f\d{1,2}$/.test(targetKey) && eventKey === targetKey) return true;
  if (targetKey === '=' && (eventKey === '=' || eventKey === '+')) return true;
  if (targetKey === '-' && (eventKey === '-' || eventKey === '_')) return true;

  return false;
}

// ──────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────

const LS_KEY = 'power-editor:keybindings';

/** id → custom shortcut string (empty string = unset) */
export type CustomKeybindings = Record<string, string>;

export function loadCustomKeybindings(): CustomKeybindings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CustomKeybindings;
  } catch {
    return {};
  }
}

export function saveCustomKeybindings(custom: CustomKeybindings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(custom));
  } catch { /* ignore */ }
}

// ──────────────────────────────────────────────────────────────
// Jotai atoms
// ──────────────────────────────────────────────────────────────

export const customKeybindingsAtom = atom<CustomKeybindings>(loadCustomKeybindings());

export const keybindingsDialogOpenAtom = atom<boolean>(false);

/**
 * Get the effective shortcut for an action (custom override or default).
 */
export function getEffectiveShortcut(id: string, customs: CustomKeybindings): string {
  if (id in customs) return customs[id];
  const def = DEFAULT_KEYBINDINGS.find((d) => d.id === id);
  return def?.defaultShortcut ?? '';
}

/**
 * Build a map from shortcut string → action id for quick dispatch lookup.
 */
export function buildShortcutMap(customs: CustomKeybindings): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of DEFAULT_KEYBINDINGS) {
    if (!def.editable) continue;
    const shortcut = getEffectiveShortcut(def.id, customs);
    if (shortcut) {
      map.set(shortcut.toLowerCase(), def.id);
    }
  }
  return map;
}
