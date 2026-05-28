/**
 * SecondaryZone — right-side toggleable panel for Settings,
 * Checkpoints history, and Context Inspector. Closed by default;
 * slides open beside the conversation surface without a modal backdrop.
 */

import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  useSecondaryZoneStore,
  SECONDARY_ZONE_WIDTH
} from '../../store/useSecondaryZoneStore.js';
import { PanelFrame } from './PanelFrame.js';
import { chromeEdgeClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

const SettingsPanel = lazy(() =>
  import('../settings/index.js').then((m) => ({ default: m.SettingsPanel }))
);
const CheckpointsPanel = lazy(() =>
  import('../checkpoints/CheckpointsView.js').then((m) => ({ default: m.CheckpointsPanel }))
);
const ContextInspectorZonePanel = lazy(() =>
  import('../contextInspector/index.js').then((m) => ({
    default: m.ContextInspectorZonePanel
  }))
);
const ReviewDrawerPanel = lazy(() =>
  import('../checkpoints/review/ReviewDrawerPanel.js').then((m) => ({
    default: m.ReviewDrawerPanel
  }))
);

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
  );
}

export function SecondaryZone() {
  const panel = useSecondaryZoneStore((s) => s.panel);
  const settingsTab = useSecondaryZoneStore((s) => s.settingsTab);
  const close = useSecondaryZoneStore((s) => s.close);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const panelWidth = panel ? SECONDARY_ZONE_WIDTH[panel] : '0px';

  useEffect(() => {
    if (!panel) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      (focusables[0] ?? root).focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel, close]);

  const panelLabel =
    panel === 'settings'
      ? 'Settings'
      : panel === 'checkpoints'
        ? 'Checkpoint history'
        : panel === 'inspector'
          ? 'Context Inspector'
          : panel === 'review'
            ? 'Review pending changes'
            : undefined;

  return (
    <aside
      role="complementary"
      aria-label={panelLabel}
      aria-hidden={panel === null}
      className={cn(
        'min-w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
        panel
          ? cn('border-l bg-surface-raised/20', chromeEdgeClassName)
          : 'pointer-events-none border-0'
      )}
      style={panel ? { width: panelWidth } : { width: 0 }}
    >
      {panel && (
        <div
          ref={panelRef}
          tabIndex={-1}
          className="flex h-full min-w-[320px] flex-col outline-none"
          style={{ width: panelWidth }}
        >
          <Suspense fallback={null}>
            {panel === 'settings' && (
              <PanelFrame
                title="Settings"
                onClose={close}
                contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
                className="h-full"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
                  <SettingsPanel initialTab={settingsTab} embedded />
                </div>
              </PanelFrame>
            )}
            {panel === 'checkpoints' && (
              <PanelFrame
                title="Checkpoint history"
                onClose={close}
                contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
                className="h-full"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
                  <CheckpointsPanel embedded />
                </div>
              </PanelFrame>
            )}
            {panel === 'inspector' && (
              <ContextInspectorZonePanel onClose={close} embedded />
            )}
            {panel === 'review' && (
              <PanelFrame
                title="Review"
                onClose={close}
                contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
                className="h-full"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
                  <ReviewDrawerPanel />
                </div>
              </PanelFrame>
            )}
          </Suspense>
        </div>
      )}
    </aside>
  );
}
