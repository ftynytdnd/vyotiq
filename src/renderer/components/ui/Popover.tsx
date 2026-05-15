/**
 * Popover — portal-based anchored popover primitive.
 *
 * Why this exists:
 *   Several composer surfaces sit inside cards that use `overflow-hidden` to
 *   clip their rounded corners. A naively absolutely-positioned popover gets
 *   visually clipped by those ancestors and ends up rendering INSIDE the
 *   card. Portaling to `document.body` and positioning via `position: fixed`
 *   on the trigger's bounding rect escapes every ancestor `overflow:hidden`
 *   (and `transform` / `filter` containment, too).
 *
 * Behavior:
 *   - Opens on the side the trigger has more room. Defaults to `bottom`,
 *     flips to `top` when the trigger sits below 60% of the viewport.
 *   - Re-anchors on window `resize`, scroll (capture so inner scroll
 *     containers fire too), trigger `ResizeObserver`, and any `revision`
 *     prop bump (callers use this to force a measurement after layout
 *     changes — e.g. sidebar toggle animations).
 *   - Outside-click and Escape close the popover. The host owns `open`.
 *
 * The host wires `triggerRef` to its anchor element and renders the
 * popover content via the `children` render prop.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn.js';

type PopoverSide = 'top' | 'bottom';
type PopoverAlign = 'start' | 'end';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Pixel gap between the trigger edge and the popover. */
  offset?: number;
  /** Horizontal alignment relative to the trigger. */
  align?: PopoverAlign;
  /**
   * Bumping this number forces a re-measurement on the next frame. Hosts
   * use it to react to layout changes outside of resize/scroll (e.g. the
   * sidebar-toggle CSS transition).
   */
  revision?: number;
  className?: string;
  children: React.ReactNode;
}

interface PopoverPosition {
  top: number;
  left: number;
  side: PopoverSide;
  /** Width of the trigger — handy for callers that want minWidth parity. */
  triggerWidth: number;
}

function measure(
  trigger: HTMLElement,
  popover: HTMLElement | null,
  offset: number,
  align: PopoverAlign
): PopoverPosition {
  const rect = trigger.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  // Open upward when the trigger is in the bottom 40% of the viewport.
  const side: PopoverSide = rect.top > viewportH * 0.6 ? 'top' : 'bottom';

  const popH = popover?.offsetHeight ?? 0;
  const popW = popover?.offsetWidth ?? 0;

  let top: number;
  if (side === 'top') {
    top = rect.top - offset - popH;
  } else {
    top = rect.bottom + offset;
  }
  // Clamp vertically inside the viewport with an 8 px margin.
  top = Math.max(8, Math.min(top, viewportH - popH - 8));

  let left: number;
  if (align === 'end') {
    left = rect.right - popW;
  } else {
    left = rect.left;
  }
  // Clamp horizontally with an 8 px margin.
  left = Math.max(8, Math.min(left, viewportW - popW - 8));

  return { top, left, side, triggerWidth: rect.width };
}

export function Popover({
  open,
  onClose,
  triggerRef,
  offset = 8,
  align = 'end',
  revision = 0,
  className,
  children
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);

  // Synchronously measure on open and whenever revision/align/offset change.
  // useLayoutEffect avoids a one-frame paint at the wrong location.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPos(measure(trigger, popoverRef.current, offset, align));
    // We may need a second measurement once the popover has rendered (so
    // its height is known) — schedule an rAF re-measure.
    const raf = requestAnimationFrame(() => {
      const t = triggerRef.current;
      if (!t) return;
      setPos(measure(t, popoverRef.current, offset, align));
    });
    return () => cancelAnimationFrame(raf);
  }, [open, revision, offset, align, triggerRef]);

  // Re-anchor on window resize, any scroll (capture catches inner
  // containers), and trigger size changes.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const reposition = () => {
      const t = triggerRef.current;
      if (!t) return;
      setPos(measure(t, popoverRef.current, offset, align));
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const ro = new ResizeObserver(reposition);
    ro.observe(trigger);
    if (popoverRef.current) ro.observe(popoverRef.current);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      ro.disconnect();
    };
  }, [open, offset, align, triggerRef]);

  // Outside-click + Escape close. Click on the trigger is also "outside"
  // from the popover's POV, so the host's toggle handler runs and closes
  // the popover naturally on its own.
  //
  // Escape-driven close ALSO restores keyboard focus to the trigger
  // before unmounting the popover content. Without this, a keyboard
  // user who opens the picker, presses Escape, and resumes typing
  // would find focus on `document.body` instead of the trigger
  // they just dismissed from — breaking the WAI-ARIA Disclosure
  // pattern. Outside-click clicks bring their own focus target (the
  // clicked element) so the restore is gated on Escape only.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only restore focus when the active element lives inside the
      // popover (typical: the picker's filter input was focused) OR
      // has fallen to body (no clear destination). If focus is
      // somewhere outside the popover the user explicitly placed
      // it there and we must not steal it back.
      const active = document.activeElement;
      const insidePopover =
        active !== null &&
        popoverRef.current !== null &&
        popoverRef.current.contains(active);
      const onBody = active === null || active === document.body;
      if ((insidePopover || onBody) && triggerRef.current) {
        try {
          triggerRef.current.focus();
        } catch {
          /* defensive — focus on a detached element. */
        }
      }
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  // Render hidden (visibility:hidden) on the very first measurement so the
  // popover can size itself for the second-pass measure without flashing
  // at (0,0).
  const ready = pos !== null;
  return createPortal(
    <div
      ref={popoverRef}
      data-popover-side={pos?.side ?? 'bottom'}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: ready ? 'visible' : 'hidden',
        zIndex: 60
      }}
      className={cn('app-no-drag', className)}
    >
      {children}
    </div>,
    document.body
  );
}
