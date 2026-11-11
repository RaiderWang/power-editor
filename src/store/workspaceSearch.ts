import { atom } from 'jotai';
import type {
  FileHit,
  WorkspaceSearchDone,
  WorkspaceSearchMode,
} from '../types/workspaceSearch';

const STORAGE_OPTIONS_KEY = 'power-editor:ws-search-options';

export interface WorkspaceSearchOptions {
  mode: WorkspaceSearchMode;
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  /** Also search `.gitignore`d / hidden files and `node_modules`. */
  includeIgnored: boolean;
}

const DEFAULT_OPTIONS: WorkspaceSearchOptions = {
  mode: 'content',
  caseSensitive: false,
  wholeWord: false,
  isRegex: false,
  includeIgnored: false,
};

function loadOptions(): WorkspaceSearchOptions {
  try {
    const raw = localStorage.getItem(STORAGE_OPTIONS_KEY);
    if (raw) return { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<WorkspaceSearchOptions>) };
  } catch {
    // ignore corrupt / unavailable storage
  }
  return DEFAULT_OPTIONS;
}

export function saveWorkspaceSearchOptions(options: WorkspaceSearchOptions): void {
  try {
    localStorage.setItem(STORAGE_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // ignore
  }
}

export const workspaceSearchQueryAtom = atom<string>('');

export const workspaceSearchOptionsAtom = atom<WorkspaceSearchOptions>(loadOptions());

/**
 * Set to `true` to ask the sidebar search input to focus (and select) itself. The input
 * consumes the request (resets it to `false`), so re-mounting the sidebar (Ctrl+B) later
 * does not steal focus.
 */
export const workspaceSearchFocusPendingAtom = atom<boolean>(false);

/**
 * Folder the current query belongs to. Lives in an atom (not a ref) because the sidebar
 * unmounts when hidden; the query is only cleared when the folder really changed.
 */
export const workspaceSearchScopeAtom = atom<string | null>(null);

export type WorkspaceSearchStatus = 'idle' | 'searching' | 'done' | 'error';

export interface WorkspaceSearchState {
  /** Job whose events are accepted; events of other jobs are stale. */
  jobId: string | null;
  /** Mode the current results were produced with (the options may have changed since). */
  mode: WorkspaceSearchMode;
  status: WorkspaceSearchStatus;
  files: FileHit[];
  scannedFiles: number;
  hitFiles: number;
  hitCount: number;
  done: WorkspaceSearchDone | null;
  error: string | null;
}

export const IDLE_WORKSPACE_SEARCH: WorkspaceSearchState = {
  jobId: null,
  mode: 'content',
  status: 'idle',
  files: [],
  scannedFiles: 0,
  hitFiles: 0,
  hitCount: 0,
  done: null,
  error: null,
};

export const workspaceSearchStateAtom = atom<WorkspaceSearchState>(IDLE_WORKSPACE_SEARCH);
