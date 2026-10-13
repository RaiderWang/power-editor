import React, { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Quote,
  List,
  ListOrdered,
  ListTodo,
  SquareCode,
  Link,
  Table,
  Minus,
} from 'lucide-react';
import { activeTabAtom } from '../../store/atoms';
import { getEditorView } from '../../store/editorViewRegistry';
import {
  wrapInline,
  applyHeading,
  toggleLinePrefix,
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  insertTable,
} from '../../utils/markdownFormatters';
import { useTranslation } from '../../i18n';
import styles from './MarkdownToolbar.module.css';

export const MarkdownToolbar: React.FC = () => {
  const activeTab = useAtomValue(activeTabAtom);
  const t = useTranslation();

  const withView = useCallback((action: (view: ReturnType<typeof getEditorView>) => void) => {
    if (!activeTab) return;
    const view = getEditorView(activeTab.bufferId);
    if (!view) return;
    action(view);
  }, [activeTab]);

  const isDisabled = !activeTab;

  return (
    <div className={styles.markdownToolbar} role="toolbar" aria-label="Markdown Toolbar">
      <span className={styles.badge} title={t('markdown.badgeTip')}>MD</span>

      {/* Headings */}
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && applyHeading(v, 1))}
        title={t('markdown.h1')}
      >
        <Heading1 size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && applyHeading(v, 2))}
        title={t('markdown.h2')}
      >
        <Heading2 size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && applyHeading(v, 3))}
        title={t('markdown.h3')}
      >
        <Heading3 size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && applyHeading(v, 4))}
        title={t('markdown.h4')}
      >
        <Heading4 size={15} />
      </button>

      <div className={styles.separator} />

      {/* Inline styles */}
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && wrapInline(v, '**', '**', 'bold'))}
        title={t('markdown.bold')}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && wrapInline(v, '*', '*', 'italic'))}
        title={t('markdown.italic')}
      >
        <Italic size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && wrapInline(v, '~~', '~~', 'strikethrough'))}
        title={t('markdown.strikethrough')}
      >
        <Strikethrough size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && wrapInline(v, '`', '`', 'code'))}
        title={t('markdown.inlineCode')}
      >
        <Code size={15} />
      </button>

      <div className={styles.separator} />

      {/* Lists & Quotes */}
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && toggleLinePrefix(v, 'quote'))}
        title={t('markdown.quote')}
      >
        <Quote size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && toggleLinePrefix(v, 'bullet'))}
        title={t('markdown.bulletList')}
      >
        <List size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && toggleLinePrefix(v, 'number'))}
        title={t('markdown.numberedList')}
      >
        <ListOrdered size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && toggleLinePrefix(v, 'task'))}
        title={t('markdown.taskList')}
      >
        <ListTodo size={15} />
      </button>

      <div className={styles.separator} />

      {/* Block & Insertions */}
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && insertCodeBlock(v))}
        title={t('markdown.codeBlock')}
      >
        <SquareCode size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && insertLink(v))}
        title={t('markdown.link')}
      >
        <Link size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && insertTable(v))}
        title={t('markdown.table')}
      >
        <Table size={15} />
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={isDisabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => withView((v) => v && insertHorizontalRule(v))}
        title={t('markdown.horizontalRule')}
      >
        <Minus size={15} />
      </button>
    </div>
  );
};
