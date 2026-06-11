/**
 * Popover placement — anchor to trigger without sliding over it when
 * the panel is taller than the available viewport slice.
 */

export type PopoverSide = 'top' | 'bottom';
export type PopoverAlign = 'start' | 'end' | 'fit';

export interface PopoverCollisionPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  side: PopoverSide;
  triggerWidth: number;
  /** When the panel exceeds available space on the chosen side. */
  maxHeight?: number;
  /** When the panel exceeds available horizontal space. */
  maxWidth?: number;
}

const MIN_USABLE_HEIGHT = 120;
const MAX_MODEL_PICKER_WIDTH = 768; // 48rem

function spaceAbove(rect: DOMRect, padTop: number, offset: number): number {
  return Math.max(0, rect.top - padTop - offset);
}

function spaceBelow(rect: DOMRect, viewportH: number, padBottom: number, offset: number): number {
  return Math.max(0, viewportH - padBottom - rect.bottom - offset);
}

function pickSide(
  preferSide: PopoverSide | 'auto',
  rect: DOMRect,
  viewportH: number,
  padTop: number,
  padBottom: number,
  offset: number
): PopoverSide {
  const above = spaceAbove(rect, padTop, offset);
  const below = spaceBelow(rect, viewportH, padBottom, offset);

  if (preferSide === 'auto') {
    return above >= below ? 'top' : 'bottom';
  }

  const prefSpace = preferSide === 'top' ? above : below;
  const altSpace = preferSide === 'top' ? below : above;
  if (prefSpace >= altSpace || prefSpace >= MIN_USABLE_HEIGHT) return preferSide;
  return preferSide === 'top' ? 'bottom' : 'top';
}

function resolveHorizontal(
  rect: DOMRect,
  popW: number,
  align: PopoverAlign,
  viewportW: number,
  padLeft: number,
  padRight: number,
  anchorStrict: boolean,
  fitMaxWidth: number
): { left: number; maxWidth: number } {
  const availW = Math.max(0, viewportW - padLeft - padRight);
  const maxWidth = Math.min(fitMaxWidth, availW);

  let left: number;
  if (align === 'end') {
    left = rect.right - (popW > 0 ? Math.min(popW, maxWidth) : maxWidth);
  } else if (align === 'fit') {
    left = Math.max(padLeft, Math.min(rect.left, viewportW - padRight - maxWidth));
  } else {
    left = rect.left;
  }

  if (anchorStrict || align === 'fit') {
    if (left + maxWidth > viewportW - padRight) {
      left = viewportW - padRight - maxWidth;
    }
    if (left < padLeft) left = padLeft;
  } else {
    left = Math.max(padLeft, Math.min(left, viewportW - maxWidth - padRight));
  }

  return { left, maxWidth };
}

export function measurePopoverPosition(
  anchor: HTMLElement,
  popover: HTMLElement | null,
  offset: number,
  align: PopoverAlign,
  collisionPadding: PopoverCollisionPadding = {},
  preferSide: PopoverSide | 'auto' = 'auto',
  anchorStrict = false,
  fitMaxWidth = MAX_MODEL_PICKER_WIDTH
): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const padTop = collisionPadding.top ?? 8;
  const padBottom = collisionPadding.bottom ?? 8;
  const padLeft = collisionPadding.left ?? 8;
  const padRight = collisionPadding.right ?? 8;

  const popH = popover?.offsetHeight ?? 0;
  const popW = popover?.offsetWidth ?? 0;

  const side = pickSide(preferSide, rect, viewportH, padTop, padBottom, offset);
  const available =
    side === 'top'
      ? spaceAbove(rect, padTop, offset)
      : spaceBelow(rect, viewportH, padBottom, offset);

  const maxHeight = popH > 0 ? Math.min(popH, available) : available > 0 ? available : undefined;
  const placedHeight = popH > 0 ? Math.min(popH, available) : popH;

  let top: number;
  if (side === 'top') {
    top = rect.top - offset - placedHeight;
  } else {
    top = rect.bottom + offset;
  }

  const { left, maxWidth } = resolveHorizontal(
    rect,
    popW,
    align,
    viewportW,
    padLeft,
    padRight,
    anchorStrict,
    fitMaxWidth
  );

  return { top, left, side, triggerWidth: rect.width, maxHeight, maxWidth };
}

/** Read title bar height from CSS for popover top inset. */
export function readTitlebarInsetPx(): number {
  if (typeof document === 'undefined') return 34;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h').trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 34;
}
