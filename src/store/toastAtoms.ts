import { atom } from 'jotai';

export interface ToastState {
  /** Monotonic id; a new toast replaces the previous one and restarts the dismiss timer. */
  id: number;
  message: string;
}

/** The single visible toast, or `null`. Rendered by `ToastHost`. */
export const toastAtom = atom<ToastState | null>(null);

let nextToastId = 1;

/** Write-only atom: `set(showToastAtom, 'text')` displays a non-blocking toast. */
export const showToastAtom = atom(null, (_get, set, message: string) => {
  set(toastAtom, { id: nextToastId++, message });
});
