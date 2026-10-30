import { atom } from 'jotai';

/** Tab ids for which the user has opened the Markdown preview (per-tab memory). */
export const previewTabIdsAtom = atom<string[]>([]);
