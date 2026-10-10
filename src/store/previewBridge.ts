import { getEditorView } from './editorViewRegistry';

const docChangeListeners = new Map<number, Set<() => void>>();
const fullLoaders = new Map<number, () => Promise<boolean>>();

/**
 * Subscribe to document content changes for a specific buffer.
 * Returns an unsubscribe function.
 */
export function subscribeDocChange(bufferId: number, listener: () => void): () => void {
  let listeners = docChangeListeners.get(bufferId);
  if (!listeners) {
    listeners = new Set();
    docChangeListeners.set(bufferId, listeners);
  }
  listeners.add(listener);

  return () => {
    const set = docChangeListeners.get(bufferId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        docChangeListeners.delete(bufferId);
      }
    }
  };
}

/**
 * Called by Editor updateListener when the document changes.
 */
export function notifyDocChange(bufferId: number): void {
  const listeners = docChangeListeners.get(bufferId);
  if (listeners) {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('[previewBridge] listener error:', err);
      }
    });
  }
}

/**
 * Register the full document loader for a buffer (provided by Editor.tsx).
 */
export function registerFullLoader(bufferId: number, loader: () => Promise<boolean>): void {
  fullLoaders.set(bufferId, loader);
}

/**
 * Unregister the full loader and clear listeners when an editor view unmounts.
 */
export function unregisterFullLoader(bufferId: number): void {
  fullLoaders.delete(bufferId);
  docChangeListeners.delete(bufferId);
}

/**
 * Ensures that the active editor for the given buffer has loaded the entire file
 * content into CodeMirror, matching the select-all path.
 */
export async function ensureFullyLoaded(bufferId: number): Promise<boolean> {
  const loader = fullLoaders.get(bufferId);
  if (loader) {
    return await loader();
  }
  return false;
}

export { getEditorView };
