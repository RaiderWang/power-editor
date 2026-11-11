import { useCallback } from 'react';
import { useSetAtom, useStore } from 'jotai';
import { useFile } from '../../../hooks/useFile';
import { useTranslation } from '../../../i18n';
import { revealMatchInBuffer } from '../../../store/revealMatch';
import { showToastAtom } from '../../../store/toastAtoms';
import type { FileHit, LineHit } from '../../../types/workspaceSearch';

/**
 * Opens a folder-search result: the file (existing tab is reused) and, for a content hit,
 * scrolls to / selects the match.
 */
export function useOpenSearchHit() {
  const store = useStore();
  const { openFile } = useFile();
  const showToast = useSetAtom(showToastAtom);
  const t = useTranslation();

  // `t` is a new function every render, so it is read through the render closure only.
  return useCallback(
    async (file: FileHit, hit?: LineHit) => {
      try {
        const tab = await openFile(file.path);
        if (!tab || !hit) return;
        await revealMatchInBuffer({
          store,
          tabId: tab.id,
          hit,
          encoding: file.encoding,
          notify: showToast,
          messages: {
            approximate: t('wsearch.reveal.approximate'),
            loadFailed: t('wsearch.reveal.loadFailed'),
          },
        });
      } catch (err) {
        console.error('[WorkspaceSearch] open result failed:', err);
        showToast(t('wsearch.openFailed', { error: String(err) }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, openFile, showToast],
  );
}
