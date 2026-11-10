/**
 * Maps bufferId → function that tells whether the PRIMARY editor's CodeMirror
 * document currently contains the WHOLE file (window starts at file line 0 and
 * every line is loaded).
 *
 * Used by Replace All to decide whether the replacement can be made undoable
 * through CodeMirror's history (only safe when CM holds the full document).
 */
const coverageRegistry = new Map<number, () => boolean>();

export function registerWindowCoverage(bufferId: number, fn: () => boolean): void {
  coverageRegistry.set(bufferId, fn);
}

export function unregisterWindowCoverage(bufferId: number): void {
  coverageRegistry.delete(bufferId);
}

/** True when CM holds the full document. Unknown buffers are treated as NOT covering. */
export function isWindowCoveringFullDoc(bufferId: number): boolean {
  return coverageRegistry.get(bufferId)?.() ?? false;
}
