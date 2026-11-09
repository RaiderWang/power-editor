import { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import type { Extension } from '@codemirror/state';
import { useOpenLink } from './useOpenLink';
import { useTranslation } from '../i18n';
import { showToastAtom } from '../store/toastAtoms';
import { markdownLinkClickExtension } from '../extensions/markdownLinkClick';
import type { MarkdownLinkClickHandlers } from '../extensions/markdownLinkClick';

/**
 * Returns a STABLE CodeMirror extension implementing Markdown Ctrl+click links for the editor
 * of the document at `docPath`. The extension reads the latest handlers through a ref, so it
 * never needs to be rebuilt (and the editor never needs to be reconfigured) when they change.
 */
export function useMarkdownLinkClick(docPath: string | null): Extension {
  const openLink = useOpenLink();
  const showToast = useSetAtom(showToastAtom);
  const t = useTranslation();

  const handlersRef = useRef<MarkdownLinkClickHandlers | null>(null);
  useEffect(() => {
    handlersRef.current = {
      openLink: (link) => {
        void openLink(link, { docPath });
      },
      anchorMissing: (heading) => {
        showToast(t('link.anchorNotFound', { heading }));
      },
    };
  });

  const [extension] = useState<Extension>(() =>
    markdownLinkClickExtension(() => ({
      openLink: (link) => handlersRef.current?.openLink(link),
      anchorMissing: (heading) => handlersRef.current?.anchorMissing(heading),
    })),
  );
  return extension;
}
