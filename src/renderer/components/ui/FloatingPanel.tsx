/**
 * Resizable floating panel over chat with dim backdrop (no blur).
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn.js';
import { bindFocusTrap, focusFirstFocusable } from '../../lib/focusTrap.js';
import { PanelHeader } from './PanelHeader.js';

const WIDTH_MIN = 320;
const WIDTH_MAX = 720;
const WIDTH_DEFAULT = 480;
/** Full-width panel at or below this viewport width. */
const NARROW_MQ = '(max-width: 560px)';

export interface FloatingPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Persisted width key (settings `ui.panelWidths`). */
  widthKey?: string;
  initialWidth?: number;
  onWidthChange?: (width: number) => void;
  /** When false, omit the dim backdrop (use a shared app-level backdrop). */
  showBackdrop?: boolean;
  className?: string;
  headerActions?: ReactNode;
}

function clampWidth(px: number): number {
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, px));
}

export function FloatingPanel({
  open,
  onClose,
  title,
  children,
  widthKey,
  initialWidth = WIDTH_DEFAULT,
  onWidthChange,
  showBackdrop = true,
  className,
  headerActions
}: FloatingPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(clampWidth(initialWidth));
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const moveHandlerRef = useRef<((ev: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_MQ).matches
  );

  const applyPanelWidth = useCallback((px: number, isNarrow: boolean) => {
    const el = panelRef.current;
    if (!el) return;
    if (isNarrow) {
      el.style.width = '';
      el.style.removeProperty('--vx-panel-width');
      return;
    }
    const w = clampWidth(px);
    widthRef.current = w;
    el.style.setProperty('--vx-panel-width', `${w}px`);
    el.style.width = `min(${w}px, 92vw)`;
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    widthRef.current = clampWidth(initialWidth);
    if (open) applyPanelWidth(widthRef.current, narrow);
  }, [initialWidth, open, narrow, applyPanelWidth]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => applyPanelWidth(widthRef.current, narrow);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, narrow, applyPanelWidth]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const root = panelRef.current;
      if (root) focusFirstFocusable(root);
    });
    const unbindTrap = bindFocusTrap({
      getRoot: () => panelRef.current,
      onEscape: onClose
    });
    return () => {
      cancelAnimationFrame(raf);
      unbindTrap();
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('pointermove', moveHandlerRef.current);
        moveHandlerRef.current = null;
      }
      if (upHandlerRef.current) {
        window.removeEventListener('pointerup', upHandlerRef.current);
        upHandlerRef.current = null;
      }
      dragRef.current = null;
    };
  }, []);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (narrow) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: widthRef.current };
      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        applyPanelWidth(d.startW + (d.startX - ev.clientX), false);
      };
      const onUp = () => {
        dragRef.current = null;
        moveHandlerRef.current = null;
        upHandlerRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        onWidthChange?.(widthRef.current);
      };
      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [applyPanelWidth, narrow, onWidthChange]
  );

  if (!open) return null;

  return createPortal(
    <div className="vx-floating-panel-root fixed inset-0 z-(--z-overlay-panel) flex justify-end pointer-events-none">
      {showBackdrop ? (
        <button
          type="button"
          className="absolute inset-0 bg-black/40 pointer-events-auto"
          aria-label="Close panel"
          onClick={onClose}
        />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-panel-width-key={widthKey}
        style={narrow ? undefined : { width: `min(${widthRef.current}px, 92vw)` }}
        className={cn(
          'vx-floating-panel relative flex max-h-[100dvh] flex-col border-l border-border-subtle/25 bg-surface-raised shadow-2xl pointer-events-auto',
          narrow ? 'w-full max-w-none' : 'max-w-[min(720px,92vw)]',
          className
        )}
      >
        {!narrow ? (
          <div
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize"
            onPointerDown={onResizePointerDown}
            aria-hidden
          />
        ) : null}
        <PanelHeader
          title={title}
          titleId={titleId}
          actions={headerActions}
          onClose={onClose}
        />
        <div className="vx-floating-panel-body min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
