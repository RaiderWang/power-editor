import { atom } from 'jotai';
import type { Update } from '@tauri-apps/plugin-updater';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'upToDate'
  | 'downloading'
  | 'installing'
  | 'error';

export interface UpdateDetails {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/** Raw Update object returned by `@tauri-apps/plugin-updater` check() */
export const availableUpdateAtom = atom<Update | null>(null);

/** Clean displayable details of the available update */
export const updateDetailsAtom = atom<UpdateDetails | null>(null);

/** Current phase of the updater */
export const updateStatusAtom = atom<UpdateStatus>('idle');

/** Progress during downloading phase */
export const updateProgressAtom = atom<UpdateProgress>({
  downloaded: 0,
  total: 0,
  percentage: 0,
});

/** Error message when check or install fails */
export const updateErrorAtom = atom<string | null>(null);

/** Controls whether the update modal dialog is visible */
export const updateDialogOpenAtom = atom<boolean>(false);
