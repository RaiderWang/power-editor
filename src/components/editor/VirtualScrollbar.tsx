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
  // Offset from thumb-top to mouse at drag-start (0-1 fraction of track height).
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

  // Effective size and top are clamped in JS so the thumb never overflows
  // the track, regardless of CSS min-height rules.
  const effectiveSize = Math.max(size, MIN_THUMB_PX / trackHeight);
  const effectiveTop = Math.min(dragTop !== null ? dragTop : top, 1 - effectiveSize);

  const ratioFromClientY = useCallback((clientY: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const { top: trackTop, height: trackH } = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientY - trackTop) / trackH));
  }, []);

  const handleTrackMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if ((e.target as HTMLElement).dataset.thumb) return;
    onSeek(ratioFromClientY(e.clientY));
  }, [onSeek, ratioFromClientY]);

  const handleThumbMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragOffsetRef.current = ratioFromClientY(e.clientY) - effectiveTop;
    setDragTop(effectiveTop);
    lastSeekTimeRef.current = 0;
  }, [effectiveTop, ratioFromClientY]);

  useEffect(() => {
    if (dragTop === null) return;

    const onMove = (e: MouseEvent) => {
      const ratio = Math.max(0, Math.min(1, ratioFromClientY(e.clientY) - dragOffsetRef.current));
      setDragTop(ratio);
      // Throttle IPC calls while dragging so content updates smoothly.
      const now = Date.now();
      if (now - lastSeekTimeRef.current >= DRAG_THROTTLE_MS) {
        lastSeekTimeRef.current = now;
        onSeek(ratio);
      }
    };

    const onUp = (e: MouseEvent) => {
      const ratio = Math.max(0, Math.min(1, ratioFromClientY(e.clientY) - dragOffsetRef.current));
      setDragTop(null);
      onSeek(ratio);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragTop, onSeek, ratioFromClientY]);

  const thumbTopPct = `${(effectiveTop * 100).toFixed(3)}%`;
  const thumbSizePct = `${(effectiveSize * 100).toFixed(3)}%`;

  return (
    <div
      ref={trackRef}
      className={styles.track}
      onMouseDown={handleTrackMouseDown}
    >
      <div
        className={styles.thumb}
        style={{ top: thumbTopPct, height: thumbSizePct }}
        data-thumb="1"
        onMouseDown={handleThumbMouseDown}
      />
    </div>
  );
};
