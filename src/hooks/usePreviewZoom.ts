import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { useAtom } from 'jotai';
import { editorPrefsAtom } from '../store/atoms';
import { adjustPreviewZoom } from '../store/previewZoom';
import { PREVIEW_ZOOM_STEP } from '../store/previewZoomLimits';

/** Accumulated wheel delta (px) needed for one zoom step. A mouse notch (~100) is one step. */
const WHEEL_STEP_THRESHOLD = 50;
/** Wheel events further apart than this start a fresh accumulation. */
const WHEEL_IDLE_RESET_MS = 250;
/** Approximate pixels per line when the wheel reports `deltaMode === DOM_DELTA_LINE`. */
const LINE_HEIGHT_PX = 33;

/**
 * Markdown preview zoom: applies `--preview-zoom` to the scroll container (keeping the
 * scroll position proportional) and handles Ctrl+wheel / trackpad pinch on the pane root.
 */
export function usePreviewZoom(
  paneRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
): { previewZoom: number; zoomIn: () => void; zoomOut: () => void; zoomReset: () => void } {
  const [prefs, setPrefs] = useAtom(editorPrefsAtom);
  const previewZoom = prefs.previewZoom;

  // The variable is set imperatively (not via JSX style) so the old scroll ratio can be read
  // *before* the new zoom reaches the DOM; the ratio is then re-applied to the new height.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const oldMax = el.scrollHeight - el.clientHeight;
    const ratio = oldMax > 0 ? el.scrollTop / oldMax : 0;
    el.style.setProperty('--preview-zoom', String(previewZoom / 100));
    if (el.clientHeight === 0 || ratio === 0) return;
    const newMax = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.round(ratio * newMax);
  }, [previewZoom, scrollRef]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    let acc = 0;
    let lastTime = 0;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Always swallow Ctrl+wheel inside the pane (also pinch gestures, which arrive as ctrlKey wheels).
      e.preventDefault();

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= LINE_HEIGHT_PX;
      else if (e.deltaMode === 2) dy *= pane.clientHeight;
      if (dy === 0) return;

      if (e.timeStamp - lastTime > WHEEL_IDLE_RESET_MS || Math.sign(dy) !== Math.sign(acc)) {
        acc = 0;
      }
      lastTime = e.timeStamp;
      acc += dy;

      if (Math.abs(acc) >= WHEEL_STEP_THRESHOLD) {
        // Wheel up (negative deltaY) zooms in.
        adjustPreviewZoom(setPrefs, acc < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP);
        acc = 0;
      }
    };

    pane.addEventListener('wheel', onWheel, { passive: false });
    return () => pane.removeEventListener('wheel', onWheel);
  }, [paneRef, setPrefs]);

  return {
    previewZoom,
    zoomIn: () => adjustPreviewZoom(setPrefs, PREVIEW_ZOOM_STEP),
    zoomOut: () => adjustPreviewZoom(setPrefs, -PREVIEW_ZOOM_STEP),
    zoomReset: () => adjustPreviewZoom(setPrefs, 'reset'),
  };
}
