import { useCallback, useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { useFile } from './useFile';
import { useTranslation } from '../i18n';
import { resolveNoteLinks } from '../store/tauriCommands';
import { showToastAtom } from '../store/toastAtoms';
import type { LinkTarget } from '../utils/linkTarget';

export interface OpenLinkOptions {
  /** Path of the document the link lives in (`null` for a never-saved buffer). */
  docPath: string | null;
  /**
   * The click happened inside the Markdown preview: keep the preview pane open when the target
   * is a Markdown file (otherwise `usePreviewTabSync` would close it on tab switch).
   */
  fromPreview?: boolean;
}

/**
 * Unified link opening shared by the preview (click) and the editor (Ctrl+click):
 * - external URLs -> OS default handler
 * - notes / relative files -> resolved by Rust, then opened inside Power Editor
 * Same-document `anchor` links are the caller's job (they need the preview DOM / CM view).
 * Failures surface as a non-blocking toast.
 */
export function useOpenLink() {
  const { openFile } = useFile();
  const showToast = useSetAtom(showToastAtom);
  const t = useTranslation();
  // `t` changes every render; keep the latest in a ref instead of a callback dependency.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  return useCallback(
    async (link: LinkTarget, options: OpenLinkOptions): Promise<void> => {
      if (link.kind === 'external') {
        try {
          await openUrl(link.url);
        } catch (err) {
          console.error('[link] Failed to open external URL:', link.url, err);
          showToast(tRef.current('link.openFailed', { target: link.url }));
        }
        return;
      }
      if (link.kind !== 'note') return;

      if (!options.docPath) {
        showToast(tRef.current('link.saveFirst'));
        return;
      }

      try {
        const [resolved] = await resolveNoteLinks(options.docPath, [link.target]);
        if (!resolved) {
          showToast(tRef.current('link.notFound', { target: link.target }));
          return;
        }
        await openFile(resolved, { keepPreview: options.fromPreview === true });
      } catch (err) {
        console.error('[link] Failed to open note link:', link.target, err);
        showToast(tRef.current('link.openFailed', { target: link.target }));
      }
    },
    [openFile, showToast],
  );
}
