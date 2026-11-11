import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { PREVIEW_PANE_ATTR } from '../../store/previewZoom';
import { PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN } from '../../store/previewZoomLimits';
import styles from './PreviewZoomControl.module.css';

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** Compact `− 100% +` zoom control for the Markdown preview header. */
export const PreviewZoomControl: React.FC<Props> = ({ zoom, onZoomIn, onZoomOut, onReset }) => {
  const t = useTranslation();
  return (
    <div
      className={styles.group}
      // Keep focus on the pane: a focused button that becomes `disabled` at 50% / 300% would drop
      // focus to <body>, and Ctrl+= / Ctrl+- / Ctrl+0 would then hit the editor font instead.
      onMouseDown={(e) => {
        e.preventDefault();
        e.currentTarget.closest<HTMLElement>(`[${PREVIEW_PANE_ATTR}]`)?.focus({ preventScroll: true });
      }}
    >
      <button
        type="button"
        className={styles.btn}
        title={t('preview.zoomOut')}
        disabled={zoom <= PREVIEW_ZOOM_MIN}
        onClick={onZoomOut}
      >
        <Minus size={12} />
      </button>
      <button
        type="button"
        className={styles.value}
        title={t('preview.zoomReset')}
        onClick={onReset}
      >
        {zoom}%
      </button>
      <button
        type="button"
        className={styles.btn}
        title={t('preview.zoomIn')}
        disabled={zoom >= PREVIEW_ZOOM_MAX}
        onClick={onZoomIn}
      >
        <Plus size={12} />
      </button>
    </div>
  );
};
