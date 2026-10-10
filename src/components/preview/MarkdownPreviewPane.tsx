import React, { useMemo, useEffect, useRef } from 'react';
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
  postProcessImages,
  setupLinkInterception,
  postProcessCodeBlocks,
} from '../../preview/postProcess';
import { setupScrollSync } from '../../preview/scrollSync';
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

  // Compile markdown to sanitized HTML
  const rendered = useMemo(() => {
    if (status !== 'ready' || !content) {
      return { html: '' };
    }
    return renderMarkdown(content);
  }, [status, content]);

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

    postProcessImages(el, filePath);
    void postProcessCodeBlocks(el);
  }, [rendered.html, filePath, status]);

  // Editor -> Preview scroll sync
  useEffect(() => {
    const el = contentRef.current;
    if (!el || status !== 'ready' || bufferId < 0) return;

    const view = getEditorView(bufferId);
    if (!view) return;

    return setupScrollSync(view, el, () => syncScrollRef.current);
  }, [bufferId, status]);

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
      <div ref={contentRef} className={styles.contentContainer}>
        {renderContent()}
      </div>
    </div>
  );
};
