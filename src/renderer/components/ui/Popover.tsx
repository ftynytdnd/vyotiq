/**
 * Popover — portal-based anchored popover primitive.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn.js';
import { registerEscapeLayer } from '../../lib/escapeLayerStack.js';
import {
  measurePopoverPosition,
  type PopoverAlign,
  type PopoverCollisionPadding,
  type PopoverPosition,
  type PopoverSide
} from './popoverPosition.js';

export type { PopoverSide, PopoverCollisionPadding };

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Position against this element when set; otherwise `triggerRef`. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  offset?: number;
  align?: PopoverAlign;
  collisionPadding?: PopoverCollisionPadding;
  preferSide?: PopoverSide | 'auto';
  revision?: number;
  zIndex?: number;
  anchorStrict?: boolean;
  /** Cap panel width (px) when fitting to the chat column. */
  fitMaxWidth?: number;
  /**
   * `content` — shrink-wrap menu labels (`align` start/end).
   * `panel` — stretch to `maxWidth` (`align` fit / wide panels).
   */
  widthMode?: 'content' | 'panel';
  className?: string;
  children: React.ReactNode;
}

function measure(
  triggerRef: React.RefObject<HTMLElement | null>,
  anchorRef: React.RefObject<HTMLElement | null> | undefined,
  popover: HTMLElement | null,
  offset: number,
  align: PopoverAlign,
  collisionPadding: PopoverCollisionPadding | undefined,
  preferSide: PopoverSide | 'auto',
  anchorStrict: boolean,
  fitMaxWidth: number
): PopoverPosition | null {
  const anchor = anchorRef?.current ?? triggerRef.current;
  if (!anchor) return null;
  return measurePopoverPosition(
    anchor,
    popover,
    offset,
    align,
    collisionPadding,
    preferSide,
    anchorStrict,
    fitMaxWidth
  );
}

export function Popover({
  open,
  onClose,
  triggerRef,
  anchorRef,
  offset = 8,
  align = 'end',
  collisionPadding,
  preferSide = 'auto',
  revision = 0,
  zIndex = 60,
  anchorStrict = false,
  fitMaxWidth = 640,
  widthMode,
  className,
  children
}: PopoverProps) {
  const popoverInstanceId = useId();
  const resolvedWidthMode = widthMode ?? (align === 'fit' ? 'panel' : 'content');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);

  const reposition = useCallback(() => {
    const next = measure(
      triggerRef,
      anchorRef,
      popoverRef.current,
      offset,
      align,
      collisionPadding,
      preferSide,
      anchorStrict,
      fitMaxWidth
    );
    if (next) setPos(next);
  }, [
    triggerRef,
    anchorRef,
    offset,
    align,
    collisionPadding,
    preferSide,
    anchorStrict,
    fitMaxWidth
  ]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
    let frame = 0;
    let pass = 0;
    const remeasure = () => {
      reposition();
      pass += 1;
      if (pass < 4) frame = requestAnimationFrame(remeasure);
    };
    frame = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(frame);
  }, [open, revision, reposition]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef?.current ?? triggerRef.current;
    if (!anchor) return;

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const ro = new ResizeObserver(reposition);
    ro.observe(anchor);
    const pop = popoverRef.current;
    if (pop) ro.observe(pop);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      ro.disconnect();
    };
  }, [open, reposition, triggerRef, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      const anchor = anchorRef?.current ?? triggerRef.current;
      if (anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open, onClose, triggerRef, anchorRef]);

  useEffect(() => {
    if (!open) return;
    return registerEscapeLayer(`popover:${popoverInstanceId}`, 80, () => {
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
          /* defensive */
        }
      }
      onClose();
      return true;
    });
  }, [open, onClose, popoverInstanceId, triggerRef]);

  if (!open) return null;

  const ready = pos !== null;
  const panelWidth = resolvedWidthMode === 'panel' ? pos?.maxWidth : undefined;
  return createPortal(
    <div
      ref={popoverRef}
      data-popover-side={pos?.side ?? 'bottom'}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: panelWidth,
        maxWidth: pos?.maxWidth,
        maxHeight: pos?.maxHeight,
        overflowY: pos?.maxHeight ? 'auto' : undefined,
        visibility: ready ? 'visible' : 'hidden',
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
      className={cn('app-no-drag', resolvedWidthMode === 'content' && 'w-max', className)}
    >
      {children}
    </div>,
    document.body
  );
}
