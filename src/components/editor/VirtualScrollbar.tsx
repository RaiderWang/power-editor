import React, { useRef, useState, useCallback, useEffect } from 'react';
import styles from './VirtualScrollbar.module.css';

interface VirtualScrollbarProps {
  /** Thumb top position as a 0-1 fraction of the full file. */
  top: number;
  /** Thumb height as a 0-1 fraction of the full file. */
  size: number;
  /**
   * Called with a 0-1 ratio both during drag (throttled) and on release.
   * Implementations should handle rapid calls gracefully.
   */
  onSeek: (ratio: number) => void;
}

const MIN_THUMB_PX = 20;
const DRAG_THROTTLE_MS = 80;

export const VirtualScrollbar: React.FC<VirtualScrollbarProps> = ({ top, size, onSeek }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  // Measured track height in px; updated by ResizeObserver.
  const [trackHeight, setTrackHeight] = useState(1);
  // Local override while dragging: null means use the props-driven position.
  const [dragTop, setDragTop] = useState<number | null>(null);
  // Offset from thumb-top to pointer at drag-start (0-1 fraction of track height).
  const dragOffsetRef = useRef(0);
  // Timestamp of the last onSeek call during drag, for throttling.
  const lastSeekTimeRef = useRef(0);

  // Keep track height in sync with the DOM element.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setTrackHeight(el.clientHeight || 1);
    const ro = new ResizeObserver(() => setTrackHeight(el.clientHeight || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveSize = Math.max(size, MIN_THUMB_PX / trackHeight);
  const effectiveTop = Math.min(dragTop !== null ? dragTop : top, 1 - effectiveSize);

  // Ref-sync so pointer handlers always read the latest effectiveTop without
  // capturing a stale closure value.
  const effectiveTopRef = useRef(effectiveTop);
  effectiveTopRef.current = effectiveTop;

  const ratioFromClientY = useCallback((clientY: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const { top: trackTop, height: trackH } = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientY - trackTop) / trackH));
  }, []);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if ((e.target as HTMLElement).dataset.thumb) return;
    onSeek(ratioFromClientY(e.clientY));
  }, [onSeek, ratioFromClientY]);

  // ── Pointer-capture drag ──────────────────────────────────────────────────
  // Using setPointerCapture ensures pointermove / pointerup are always
  // delivered to this element even if the pointer moves outside it.  This
  // avoids the macOS WebKit issue where rapidly removing + re-adding
  // window-level mousemove/mouseup listeners (the old approach) caused the
  // drag to be interrupted after a small movement.
  const handleThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOffsetRef.current = ratioFromClientY(e.clientY) - effectiveTopRef.current;
    setDragTop(effectiveTopRef.current);
    lastSeekTimeRef.current = 0;
  }, [ratioFromClientY]);

  const handleThumbPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const ratio = Math.max(0, Math.min(1, ratioFromClientY(e.clientY) - dragOffsetRef.current));
    setDragTop(ratio);
    const now = Date.now();
    if (now - lastSeekTimeRef.current >= DRAG_THROTTLE_MS) {
      lastSeekTimeRef.current = now;
      onSeek(ratio);
    }
  }, [ratioFromClientY, onSeek]);

  const handleThumbPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const ratio = Math.max(0, Math.min(1, ratioFromClientY(e.clientY) - dragOffsetRef.current));
    setDragTop(null);
    onSeek(ratio);
  }, [ratioFromClientY, onSeek]);

  // Clean up drag state if the pointer gesture is cancelled by the OS
  // (e.g. a system gesture recognizer takes over on macOS).
  const handleThumbPointerCancel = useCallback((_e: React.PointerEvent<HTMLDivElement>) => {
    setDragTop(null);
  }, []);

  const thumbTopPct = `${(effectiveTop * 100).toFixed(3)}%`;
  const thumbSizePct = `${(effectiveSize * 100).toFixed(3)}%`;

  return (
    <div
      ref={trackRef}
      className={styles.track}
      onPointerDown={handleTrackPointerDown}
    >
      <div
        className={styles.thumb}
        style={{ top: thumbTopPct, height: thumbSizePct }}
        data-thumb="1"
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerCancel}
      />
    </div>
  );
};
