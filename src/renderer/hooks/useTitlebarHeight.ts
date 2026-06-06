/**
 * Measures the frameless title bar and publishes `--titlebar-h` and
 * `--dock-strip-pt` on `:root`. Dock rail icons start below the title
 * bar so the hamburger (title bar) and expand chevron (dock) never overlap.
 */

import { useLayoutEffect, type RefObject } from 'react';

/** Ignore transient 0px reads before the title bar lays out. */
const MIN_TITLEBAR_PX = 24;

function applyTitlebarMetrics(heightPx: number): void {
  if (heightPx < MIN_TITLEBAR_PX) return;
  const root = document.documentElement;
  const h = Math.round(heightPx);
  root.style.setProperty('--titlebar-h-measured', `${h}px`);
  root.style.setProperty('--titlebar-h', `${h}px`);
  root.style.setProperty('--dock-strip-pt', `${h}px`);
}

export function useTitlebarHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      applyTitlebarMetrics(el.getBoundingClientRect().height);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
