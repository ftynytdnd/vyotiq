/**
 * Popover — portal-based anchored popover primitive.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PanelId } from '@shared/panels/panelWidths.js';
import { cn } from '../../lib/cn.js';
import { escapeFocusInRoots, registerEscapeLayer } from '../../lib/escapeLayerStack.js';
import { usePersistedPanelWidth } from '../../lib/usePersistedPanelWidth.js';
import { PanelWidthResizeHandle } from './PanelWidthResizeHandle.js';
import {
  measurePopoverNaturalHeight,
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
  /** Persist and restore width via `ui.panelWidths` when set. */
  panelId?: PanelId;
  /** When true, root clips height and defers scrolling to panel children. */
  containScroll?: boolean;
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
  fitMaxWidth: number,
  containScroll: boolean
): PopoverPosition | null {
  const anchor = anchorRef?.current ?? triggerRef.current;
  if (!anchor) return null;
  const naturalHeight =
    containScroll && popover ? measurePopoverNaturalHeight(popover) : undefined;
  return measurePopoverPosition(
    anchor,
    popover,
    offset,
    align,
    collisionPadding,
    preferSide,
    anchorStrict,
    fitMaxWidth,
    naturalHeight
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
  panelId,
  containScroll = false,
  className,
  children
}: PopoverProps) {
  const popoverInstanceId = useId();
  const resolvedWidthMode = widthMode ?? (align === 'fit' ? 'panel' : 'content');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const { width: persistedWidth, persistWidth } = usePersistedPanelWidth(panelId, fitMaxWidth);
  const effectiveFitMaxWidth = liveWidth ?? persistedWidth;

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
      effectiveFitMaxWidth,
      containScroll
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
    effectiveFitMaxWidth,
    containScroll
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

    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      reposition();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    const ro = new ResizeObserver(reposition);
    ro.observe(anchor);
    // containScroll panels size from content; observing the portal root retriggers on height locks.
    if (!containScroll) {
      const pop = popoverRef.current;
      if (pop) ro.observe(pop);
    }

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', onScroll, true);
      ro.disconnect();
    };
  }, [open, reposition, triggerRef, anchorRef, containScroll]);

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
      const anchor = anchorRef?.current ?? triggerRef.current;
      if (
        !escapeFocusInRoots(active, [popoverRef.current, triggerRef.current, anchor])
      ) {
        return false;
      }
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
  }, [open, onClose, popoverInstanceId, triggerRef, anchorRef]);

  if (!open) return null;

  const ready =
    pos !== null &&
    (resolvedWidthMode !== 'content' || (popoverRef.current?.offsetWidth ?? 0) > 0);
  const panelWidth = resolvedWidthMode === 'panel' ? pos?.maxWidth : undefined;
  const boundedHeight =
    containScroll && pos?.maxHeight !== undefined ? pos.maxHeight : undefined;
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
        height: boundedHeight,
        overflowY: containScroll ? 'hidden' : pos?.maxHeight ? 'auto' : undefined,
        visibility: ready ? 'visible' : 'hidden',
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
      className={cn(
        'app-no-drag relative',
        resolvedWidthMode === 'content' && 'w-max',
        className
      )}
    >
      {children}
      {panelId && resolvedWidthMode === 'panel' ? (
        <PanelWidthResizeHandle
          width={effectiveFitMaxWidth}
          onLiveWidth={setLiveWidth}
          onCommit={persistWidth}
        />
      ) : null}
    </div>,
    document.body
  );
}
