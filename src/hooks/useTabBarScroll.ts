import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface TabBarScrollState {
  /** Tab content is wider than the visible tab list. */
  overflowing: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

const INITIAL_STATE: TabBarScrollState = {
  overflowing: false,
  canScrollLeft: false,
  canScrollRight: false,
};

/** Sub-pixel tolerance for scroll edge detection. */
const EDGE_EPS = 1;

/**
 * Manages horizontal overflow behaviour of the tab strip:
 * - tracks overflow / scrollable-edge state (for the tab list dropdown and edge fades)
 * - keeps the active tab scrolled into view
 * - maps vertical mouse wheel to horizontal scrolling
 *
 * `ResizeObserver` observes both the scroll container (clientWidth changes) and the
 * inner content wrapper (scrollWidth changes from adding/closing/renaming tabs);
 * observing the container alone cannot detect the latter.
 */
export function useTabBarScroll(
  listRef: RefObject<HTMLDivElement | null>,
  innerRef: RefObject<HTMLDivElement | null>,
  activeTabId: string | null,
  tabCount: number,
): TabBarScrollState {
  const [state, setState] = useState<TabBarScrollState>(INITIAL_STATE);
  // The tab bar renders nothing when there are no tabs, so (re)attach listeners
  // once the scroll container actually exists.
  const hasTabs = tabCount > 0;

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth - el.clientWidth > EDGE_EPS;
    const canScrollLeft = overflowing && el.scrollLeft > EDGE_EPS;
    const canScrollRight = overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_EPS;
    setState((prev) =>
      prev.overflowing === overflowing
      && prev.canScrollLeft === canScrollLeft
      && prev.canScrollRight === canScrollRight
        ? prev
        : { overflowing, canScrollLeft, canScrollRight },
    );
  }, [listRef]);

  // Observers + scroll listener + wheel mapping.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(list);
    if (innerRef.current) ro.observe(innerRef.current);

    const onScroll = () => updateScrollState();
    list.addEventListener('scroll', onScroll, { passive: true });

    const onWheel = (e: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth) return;
      // Only remap vertical-dominant wheel input; native horizontal gestures pass through.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      list.scrollLeft += e.deltaY;
    };
    list.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      ro.disconnect();
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('wheel', onWheel);
    };
  }, [listRef, innerRef, updateScrollState, hasTabs]);

  // Fallback + first-frame correctness whenever tab set / active tab changes.
  useLayoutEffect(() => {
    updateScrollState();
  }, [tabCount, activeTabId, updateScrollState]);

  // Keep the active tab visible.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !activeTabId) return;
    const tabEl = list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    if (!tabEl) return;

    const listRect = list.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    const margin = 24; // leave room so neighbours / edge fade stay visible
    if (tabRect.left < listRect.left + margin) {
      list.scrollLeft += tabRect.left - listRect.left - margin;
    } else if (tabRect.right > listRect.right - margin) {
      list.scrollLeft += tabRect.right - listRect.right + margin;
    }
  }, [listRef, activeTabId, tabCount]);

  return state;
}
