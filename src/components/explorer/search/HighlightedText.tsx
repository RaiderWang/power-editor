import React from 'react';
import styles from './WorkspaceSearch.module.css';

interface HighlightedTextProps {
  text: string;
  /** Highlight range in UTF-16 code units (JS string indices). */
  start: number;
  end: number;
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({ text, start, end }) => {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  if (s === e) return <>{text}</>;
  return (
    <>
      {text.slice(0, s)}
      <mark className={styles.mark}>{text.slice(s, e)}</mark>
      {text.slice(e)}
    </>
  );
};
