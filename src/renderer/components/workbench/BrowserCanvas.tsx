/**
 * Browser canvas — a DOM placeholder whose rect drives the main-process
 * `WebContentsView`. The native view floats above the DOM, so we keep it
 * hidden until a page has loaded (start UI stays interactive) and tear
 * visibility down on unmount (tab switch / pane close) to avoid occluding
 * the rest of the workbench.
 */

import { useEffect, useRef, useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { vyotiq } from '../../lib/ipc.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export function BrowserCanvas() {
  const slotRef = useRef<HTMLDivElement>(null);
  const hasLoaded = useBrowserStore((s) => s.hasLoaded);
  const navigate = useBrowserStore((s) => s.navigate);
  const [draft, setDraft] = useState('');

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
      <div ref={slotRef} className="vx-browser-slot min-h-0 flex-1" />
      {!hasLoaded ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <Globe className="h-9 w-9 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
          <div className="max-w-sm space-y-1">
            <p className="text-section font-medium text-text-primary">Browser</p>
            <p className="text-row text-text-muted">
              Search the web or enter a URL. Pages open in an isolated, persistent session.
            </p>
          </div>
          <form
            className="vx-browser-start flex w-full max-w-md items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) navigate(draft.trim());
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className={cn(
                  SHELL_ROW_ICON_CLASS,
                  'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint'
                )}
                strokeWidth={SHELL_ACTION_ICON_STROKE}
              />
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search or type a URL"
                className="vx-input w-full pl-8"
              />
            </div>
            <Button type="submit" variant="primary" size="sm" className="shrink-0">
              Go
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
