import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { v4 as uuidv4 } from 'uuid';
import * as cmd from '../store/tauriCommands';
import { currentFolderPathAtom } from '../store/explorerAtoms';
import { searchOpenAtom } from '../store/atoms';
import {
  IDLE_WORKSPACE_SEARCH,
  workspaceSearchOptionsAtom,
  workspaceSearchQueryAtom,
  workspaceSearchScopeAtom,
  workspaceSearchStateAtom,
} from '../store/workspaceSearch';
import { clearRevealedHighlight } from '../store/revealMatch';
import type {
  FileHit,
  WorkspaceSearchBatch,
  WorkspaceSearchDone,
} from '../types/workspaceSearch';

const DEBOUNCE_MS = 250;

function sortByRelPath(files: FileHit[]): FileHit[] {
  return [...files].sort((a, b) => {
    const x = a.rel_path.toLowerCase();
    const y = b.rel_path.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/**
 * Drives the Explorer folder search: debounced start, stale-event filtering by job id,
 * rAF-coalesced result appends, cancellation on query / folder change and unmount.
 * Mount once (in `FileExplorer`).
 */
export function useWorkspaceSearch() {
  const store = useStore();
  const folder = useAtomValue(currentFolderPathAtom);
  const query = useAtomValue(workspaceSearchQueryAtom);
  const options = useAtomValue(workspaceSearchOptionsAtom);
  const setState = useSetAtom(workspaceSearchStateAtom);
  const setQuery = useSetAtom(workspaceSearchQueryAtom);

  const jobIdRef = useRef<string | null>(null);
  const pendingRef = useRef<FileHit[]>([]);
  const progressRef = useRef({ scanned: 0, hitFiles: 0, hitCount: 0 });
  const rafRef = useRef(0);

  // Event listeners (registered once).
  useEffect(() => {
    const flush = () => {
      rafRef.current = 0;
      const jobId = jobIdRef.current;
      const files = pendingRef.current;
      pendingRef.current = [];
      const p = progressRef.current;
      setState((prev) =>
        prev.jobId !== jobId
          ? prev
          : {
              ...prev,
              files: files.length > 0 ? prev.files.concat(files) : prev.files,
              scannedFiles: p.scanned,
              hitFiles: p.hitFiles,
              hitCount: p.hitCount,
            },
      );
    };

    const unlistenBatch = listen<WorkspaceSearchBatch>('workspace-search:batch', (event) => {
      const b = event.payload;
      if (b.job_id !== jobIdRef.current) return;
      if (b.files.length > 0) pendingRef.current.push(...b.files);
      progressRef.current = { scanned: b.scanned_files, hitFiles: b.hit_files, hitCount: b.hit_count };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    });

    const unlistenDone = listen<WorkspaceSearchDone>('workspace-search:done', (event) => {
      const d = event.payload;
      if (d.job_id !== jobIdRef.current) return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const files = pendingRef.current;
      pendingRef.current = [];
      setState((prev) =>
        prev.jobId !== d.job_id
          ? prev
          : {
              ...prev,
              files: sortByRelPath(files.length > 0 ? prev.files.concat(files) : prev.files),
              scannedFiles: d.scanned_files,
              hitFiles: d.hit_files,
              hitCount: d.hit_count,
              status: prev.status === 'error' ? 'error' : 'done',
              done: d,
            },
      );
    });

    return () => {
      unlistenBatch.then((f) => f()).catch(console.error);
      unlistenDone.then((f) => f()).catch(console.error);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [setState]);

  // A different (or closed) folder invalidates the query. Compared against the folder the
  // query was entered for (atom), so merely re-mounting the sidebar keeps the query.
  useEffect(() => {
    if (store.get(workspaceSearchScopeAtom) === folder) return;
    store.set(workspaceSearchScopeAtom, folder);
    setQuery('');
  }, [folder, setQuery, store]);

  // Start / restart the search (debounced); cancel when the query is cleared.
  useEffect(() => {
    const cancelCurrent = () => {
      const old = jobIdRef.current;
      jobIdRef.current = null;
      pendingRef.current = [];
      if (old) cmd.workspaceSearchCancel(old).catch(() => {});
    };

    // Highlights revealed from an earlier result no longer belong to this query.
    clearRevealedHighlight(store.get(searchOpenAtom));

    if (!folder || query.length === 0) {
      cancelCurrent();
      setState(IDLE_WORKSPACE_SEARCH);
      return;
    }

    const timer = window.setTimeout(() => {
      const jobId = uuidv4();
      const previous = jobIdRef.current;
      jobIdRef.current = jobId;
      pendingRef.current = [];
      progressRef.current = { scanned: 0, hitFiles: 0, hitCount: 0 };
      if (previous) cmd.workspaceSearchCancel(previous).catch(() => {});
      setState({ ...IDLE_WORKSPACE_SEARCH, jobId, mode: options.mode, status: 'searching' });

      cmd
        .workspaceSearchStart(jobId, {
          root: folder,
          mode: options.mode,
          search: {
            pattern: query,
            is_regex: options.isRegex,
            case_sensitive: options.caseSensitive,
            whole_word: options.wholeWord,
          },
          include_ignored: options.includeIgnored,
        })
        .catch((err) => {
          // e.g. an invalid regex while the user is still typing
          setState((prev) =>
            prev.jobId === jobId ? { ...prev, status: 'error', error: String(err) } : prev,
          );
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [folder, query, options, setState, store]);

  // Stop the background job when the explorer goes away.
  useEffect(() => {
    return () => {
      const old = jobIdRef.current;
      jobIdRef.current = null;
      if (old) cmd.workspaceSearchCancel(old).catch(() => {});
      setState(IDLE_WORKSPACE_SEARCH);
    };
  }, [setState]);
}
