import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { listen } from '@tauri-apps/api/event';
import { replaceProgressAtom } from '../store/replaceProgress';
import type { ReplaceProgressPayload } from '../types';

/**
 * Feeds `replace:progress` events from the Rust Replace All job into
 * `replaceProgressAtom`. Events of other buffers (or arriving after the job was
 * finished and the atom cleared) are ignored. Mount once at the top of the tree.
 */
export function useReplaceProgress() {
  const setProgress = useSetAtom(replaceProgressAtom);

  useEffect(() => {
    const unlisten = listen<ReplaceProgressPayload>('replace:progress', (event) => {
      const { buffer_id, bytes_done, total_bytes, matches } = event.payload;
      setProgress((prev) =>
        prev && prev.bufferId === buffer_id
          ? { ...prev, bytesDone: bytes_done, totalBytes: total_bytes, matches }
          : prev,
      );
    });
    return () => {
      unlisten.then((f) => f()).catch(console.error);
    };
  }, [setProgress]);
}
