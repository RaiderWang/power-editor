import { ensureFullyLoaded, getEditorView } from '../store/previewBridge';
import { getFullText } from '../store/tauriCommands';

/**
 * Loads the full document text for a buffer.
 * If the editor view is available in the DOM, ensures the full content is loaded
 * into CodeMirror and returns the view's current document state (reflecting any unsaved edits).
 * Otherwise falls back to fetching the full text directly from the Rust backend.
 */
export async function loadFullText(bufferId: number): Promise<string> {
  if (bufferId < 0) return '';

  await ensureFullyLoaded(bufferId);

  const view = getEditorView(bufferId);
  if (view) {
    return view.state.doc.toString();
  }

  try {
    return await getFullText(bufferId);
  } catch (err) {
    console.error('[loadFullText] Failed to fetch full text from backend:', err);
    return '';
  }
}
