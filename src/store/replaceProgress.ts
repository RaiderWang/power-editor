import { atom } from 'jotai';

/** State of the running Replace All (at most one at a time in the UI). */
export interface ReplaceProgressInfo {
  bufferId: number;
  bytesDone: number;
  totalBytes: number;
  /** Matches replaced so far. */
  matches: number;
  /** The user asked to cancel; waiting for Rust to stop. */
  cancelling: boolean;
}

/**
 * Non-null from the moment Replace All is started until it has finished and the
 * editor window was refreshed. While set, the progress overlay blocks the UI,
 * global shortcuts and re-triggering.
 */
export const replaceProgressAtom = atom<ReplaceProgressInfo | null>(null);

let focusToRestore: HTMLElement | null = null;

/** Remember the focused element right before Replace All starts. */
export function rememberFocus(): void {
  const el = document.activeElement;
  focusToRestore = el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * Called when the progress overlay goes away. If focus was lost (fell to `body`, or is
 * still inside the overlay) put it back where it was, so e.g. Escape still closes the
 * find panel after a cancelled run. A successful run already moved focus to the
 * editor; then nothing is touched.
 */
export function restoreFocusIfLost(overlay: HTMLElement | null): void {
  const target = focusToRestore;
  if (!target || !target.isConnected) return;
  // Still disabled (e.g. the Replace button while the job runs): this is not the real
  // teardown (React StrictMode's dev-only simulated unmount), keep the memory.
  if ('disabled' in target && (target as HTMLButtonElement).disabled) return;
  const active = document.activeElement;
  const lost = !active || active === document.body || (overlay !== null && overlay.contains(active));
  if (lost) {
    focusToRestore = null;
    target.focus();
  }
  // Not lost: either the editor took focus (successful run) or this is StrictMode's
  // simulated unmount; the memory is overwritten by the next `rememberFocus()`.
}
