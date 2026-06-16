/**
 * Browser canvas — a DOM placeholder whose rect drives the main-process
 * `WebContentsView`. The native view floats above the DOM, so we keep it
 * hidden until a page has loaded (start UI stays interactive) and tear
 * visibility down on unmount (tab switch / pane close) to avoid occluding
 * the rest of the workbench.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { vyotiq } from '../../lib/ipc.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { WorkbenchFindBar } from './WorkbenchFindBar.js';
import { BrowserEmptyState } from './BrowserEmptyState.js';
import { cn } from '../../lib/cn.js';

function BrowserFindOverlay() {
  const setFindOpen = useBrowserStore((s) => s.setFindOpen);
  const [findText, setFindText] = useState('');

  const runFind = useCallback(
    (forward: boolean) => {
      if (!findText) return;
      void vyotiq.browser.find({ text: findText, forward, findNext: true });
    },
    [findText]
  );

  return (
    <WorkbenchFindBar
      placeholder="Find in page…"
      value={findText}
      onChange={setFindText}
      onFind={runFind}
      onClose={() => {
        setFindOpen(false);
        void vyotiq.browser.stopFind();
      }}
    />
  );
}

export function BrowserCanvas() {
  const slotRef = useRef<HTMLDivElement>(null);
  const hasLoaded = useBrowserStore((s) => s.hasLoaded);
  const error = useBrowserStore((s) => s.error);
  const findOpen = useBrowserStore((s) => s.findOpen);

  // Continuously report the slot rect so the native view tracks it.
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    let raf = 0;
    const report = () => {
      const rect = el.getBoundingClientRect();
      void vyotiq.browser.setBounds({
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    report();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  // Show the native view only once a real page is loaded; always hide on unmount.
  useEffect(() => {
    void vyotiq.browser.setVisible({ visible: hasLoaded });
    return () => {
      void vyotiq.browser.setVisible({ visible: false });
    };
  }, [hasLoaded]);

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-browser-canvas relative')}>
      {findOpen ? <BrowserFindOverlay /> : null}
      {error ? (
        <p className="shrink-0 px-3 py-2 text-center text-meta text-text-muted">{error}</p>
      ) : null}
      <div ref={slotRef} className="vx-browser-slot min-h-0 flex-1" />
      {!hasLoaded && !error ? <BrowserEmptyState /> : null}
    </div>
  );
}
