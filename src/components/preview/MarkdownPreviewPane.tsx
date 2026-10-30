import React, { useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  BookOpen,
  ArrowUpDown,
  X,
  FileQuestion,
  AlertTriangle,
  Loader2,
  FileText,
} from 'lucide-react';
import { useTranslation } from '../../i18n';
import { syncScrollAtom } from '../../store/previewAtoms';
import { closeSplitAtom } from '../../store/splitAtoms';
import { getEditorView } from '../../store/previewBridge';
import { useMarkdownSource } from '../../hooks/useMarkdownSource';
import { renderMarkdown } from '../../preview/renderMarkdown';
import {
  setupLinkInterception,
  postProcessCodeBlocks,
} from '../../preview/postProcess';
import { postProcessImages } from '../../preview/imagePaths';
import { setupScrollSync } from '../../preview/scrollSync';
import { setCachedPreviewSelection } from '../../print/selectionHelper';
import styles from './MarkdownPreviewPane.module.css';

export const MarkdownPreviewPane: React.FC = () => {
  const t = useTranslation();
  const [syncScroll, setSyncScroll] = useAtom(syncScrollAtom);
  const closeSplit = useSetAtom(closeSplitAtom);

  const { status, content, bufferId, filePath, fileName } = useMarkdownSource();
  const contentRef = useRef<HTMLDivElement>(null);
  const syncScrollRef = useRef(syncScroll);
  useEffect(() => {
    syncScrollRef.current = syncScroll;
  }, [syncScroll]);

  // NOTE: `t` is a new function on every render, so memo/effect deps use the derived strings instead.
  const frontmatterLabel = t('preview.frontmatter');
  const copyTitle = t('preview.copyCode');
  const copiedTitle = t('preview.copied');

  // Remembers whether the user expanded the frontmatter card; the preview HTML is replaced on
  // every edit, which would otherwise reset <details> back to collapsed. A ref avoids re-renders.
  const frontmatterOpenRef = useRef(false);

  // Compile markdown to sanitized HTML
  const rendered = useMemo(() => {
    if (status !== 'ready' || !content) {
      return { html: '' };
    }
    return renderMarkdown(content, { frontmatterLabel });
  }, [status, content, frontmatterLabel]);

  // Re-apply the remembered expanded state right after the HTML is swapped (before paint)
  useLayoutEffect(() => {
    const details = contentRef.current?.querySelector<HTMLDetailsElement>('details.frontmatter');
    if (details) {
      details.open = frontmatterOpenRef.current;
    }
  }, [rendered.html]);

  // `toggle` does not bubble, so listen in the capture phase on the container
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLDetailsElement && target.classList.contains('frontmatter')) {
        frontmatterOpenRef.current = target.open;
      }
    };
    el.addEventListener('toggle', onToggle, true);
    return () => el.removeEventListener('toggle', onToggle, true);
  }, []);

  // Post-process links: internal smooth-scroll, external shell open
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    return setupLinkInterception(el);
  }, []);

  // Post-process images & syntax highlighting whenever HTML or filePath updates
  useEffect(() => {
    const el = contentRef.current;
    if (!el || status !== 'ready') return;

    void postProcessImages(el, filePath);
    void postProcessCodeBlocks(el, {
      copyTitle,
      copiedTitle,
    });
  }, [rendered.html, filePath, status, copyTitle, copiedTitle]);

  // Editor -> Preview scroll sync
  useEffect(() => {
    const el = contentRef.current;
    if (!el || status !== 'ready' || bufferId < 0) return;

    const view = getEditorView(bufferId);
    if (!view) return;

    return setupScrollSync(view, el, () => syncScrollRef.current);
  }, [bufferId, status]);

  // Track preview selection for intelligent print detection
  useEffect(() => {
    const handleSelectionChange = () => {
      const container = contentRef.current;
      if (!container) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        return;
      }

      const range = sel.getRangeAt(0);
      if (
        container.contains(range.commonAncestorContainer) ||
        container.contains(sel.anchorNode) ||
        container.contains(sel.focusNode)
      ) {
        const text = sel.toString();
        if (text.trim()) {
          const wrapper = document.createElement('div');
          wrapper.appendChild(range.cloneContents());
          setCachedPreviewSelection({ html: wrapper.innerHTML, text });
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      setCachedPreviewSelection(null);
    };
  }, []);

  const renderContent = () => {
    if (status === 'not_markdown') {
      return (
        <div className={styles.placeholderBox}>
          <FileQuestion size={40} className={styles.placeholderIcon} />
          <div className={styles.placeholderTitle}>{t('preview.notMarkdown')}</div>
        </div>
      );
    }

    if (status === 'loading') {
      return (
        <div className={styles.placeholderBox}>
          <Loader2 size={40} className={`${styles.placeholderIcon} ${styles.spinner}`} />
          <div className={styles.placeholderTitle}>{t('preview.loading')}</div>
        </div>
      );
    }

    if (status === 'too_large') {
      return (
        <div className={styles.placeholderBox}>
          <AlertTriangle size={40} className={styles.placeholderIcon} />
          <div className={styles.placeholderTitle}>{t('preview.tooLarge')}</div>
        </div>
      );
    }

    if (!rendered.html) {
      return (
        <div className={styles.placeholderBox}>
          <FileText size={40} className={styles.placeholderIcon} />
          <div className={styles.placeholderTitle}>{t('preview.empty')}</div>
        </div>
      );
    }

    return (
      <div
        className={styles.markdownBody}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    );
  };

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>
            <BookOpen size={14} />
            {t('preview.title')}
          </span>
          {fileName && <span className={styles.fileNameBadge}>({fileName})</span>}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${syncScroll ? styles.actionBtnActive : ''}`}
            title={t('preview.syncScroll')}
            onClick={() => setSyncScroll((v) => !v)}
          >
            <ArrowUpDown size={14} />
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            title={t('preview.close')}
            onClick={() => closeSplit()}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div
        ref={contentRef}
        data-preview-container="true"
        className={styles.contentContainer}
      >
        {renderContent()}
      </div>
    </div>
  );
};
