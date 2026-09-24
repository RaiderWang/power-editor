import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { openProgressAtom, tabsAtom } from '../store/atoms';
import type { FileInfo } from '../types';

interface ProgressPayload {
  request_id: string;
  bytes_read: number;
  total_bytes: number;
}

/**
 * Listens for Rust events related to file loading:
 *
 * - `file:open-progress` — Phase 2 background loading progress → updates
 *   `openProgressAtom` (drives the progress dialog / status-bar indicator).
 * - `file:load-complete` — Phase 2 done → updates the tab's `FileInfo` with
 *   final metadata (line count, line ending, `is_fully_loaded = true`).
 *
 * Mount once at the top of the component tree.
 */
export function useFileOpenProgress() {
  const setProgress = useSetAtom(openProgressAtom);
  const setTabs = useSetAtom(tabsAtom);

  useEffect(() => {
    const unlistenProgress = listen<ProgressPayload>('file:open-progress', (event) => {
      const { request_id, bytes_read, total_bytes } = event.payload;
      if (bytes_read >= total_bytes) {
        setProgress(null);
      } else {
        setProgress((prev) => ({
          requestId: request_id,
          bytesRead: bytes_read,
          totalBytes: total_bytes,
          fileName: prev?.fileName ?? '',
        }));
      }
    });

    const unlistenComplete = listen<FileInfo>('file:load-complete', (event) => {
      const info = event.payload;
      // Update the matching tab's fileInfo with the final metadata
      setTabs((prev) =>
        prev.map((t) =>
          t.bufferId === info.id ? { ...t, fileInfo: info } : t,
        ),
      );
      // Also dismiss any lingering progress dialog for this buffer
      setProgress(null);
    });

    return () => {
      unlistenProgress.then((f) => f()).catch(console.error);
      unlistenComplete.then((f) => f()).catch(console.error);
    };
  }, [setProgress, setTabs]);
}
