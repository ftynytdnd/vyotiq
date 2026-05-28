/**
 * Modal — primitive dialog overlay.
 *
 * Responsibilities (the only place dialog chrome lives):
 *   - Render via React portal to `document.body` so `position: fixed`
 *     escapes ancestor containment (dock / panel `overflow-hidden`,
 *     scroll-region `mask-image`, etc.). Nested consumers
 *     (`ConfirmDialog` inside a dock tab row) would otherwise render
 *     invisibly.
 *   - Lock body scroll while a modal is open so the underlying page
 *     can't drift while the user reads the dialog. Reference-counted
 *     so stacked modals (Settings → ConfirmDialog from inside it)
 *     don't double-toggle the style.
 *   - Trap keyboard focus inside the dialog: Tab/Shift+Tab cycle
 *     between the dialog's interactive descendants only.
 *   - Move initial focus into the dialog on open, restore focus to
 *     whichever element was active before open when the dialog
 *     closes — meeting the WAI-ARIA dialog pattern.
 *   - Surface ARIA semantics (`role="dialog"`, `aria-modal`,
 *     `aria-labelledby`) so screen readers announce the dialog
 *     correctly.
 *   - Close on Escape and on backdrop click.
 *
 * Backdrop close uses a mousedown-pair guard: a `mousedown` that
 * starts on the dialog body and an `mouseup` outside of it MUST NOT
 * trigger close. Otherwise a user dragging to select text from
 * inside the dialog into the surrounding chrome (a habit on long
 * read-only previews) would close the dialog on mouse release. The
 * pair guard tracks the originating `mousedown` target and only
 * fires `onClose` when both endpoints land on the backdrop itself.
 *
 * `closeOnBackdrop` lets callers opt out entirely — useful for
 * destructive flows where an accidental backdrop click could lose
 * unsaved work (e.g. RevertPreviewModal's mid-rewind state).
 *
 * Visuals (centered card, stealth backdrop, header row with close X)
 * are preserved exactly — this hardens behaviour without touching
 * aesthetics.
 */

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { chromeEdgeClassName } from './SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { IconButton } from './IconButton.js';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /**
   * When false, clicking the backdrop is a no-op — the user must
   * close the dialog via Escape or an explicit cancel button. Useful
   * for destructive flows that shouldn't be dismissable by accident.
   * Defaults to true to preserve existing behaviour.
   */
  closeOnBackdrop?: boolean;
}

/**
 * Reference-counted body-scroll lock. Multiple stacked modals share
 * the same lock — the first to open applies `overflow: hidden` and
 * the last to close restores the original value.
 */
let scrollLockCount = 0;
let scrollLockOriginalOverflow: string | null = null;

function acquireScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    scrollLockOriginalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function releaseScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = scrollLockOriginalOverflow ?? '';
    scrollLockOriginalOverflow = null;
  }
}

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

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdrop = true
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  /**
   * Tracks where the most recent backdrop `mousedown` originated.
   * Set to `'backdrop'` only when the press lands on the backdrop
   * element itself (not on any descendant of the dialog). The
   * mouseup handler then closes the dialog only when its own target
   * is the backdrop AND the originating mousedown was the backdrop
   * — covering both a clean backdrop click and rejecting a click
   * that started inside the dialog (text drag-select).
   */
  const downOriginRef = useRef<'backdrop' | 'dialog' | null>(null);

  // Acquire / release the body-scroll lock for the lifetime of the
  // open state. Strict-mode double-invoke is harmless because the
  // counter is incremented and decremented symmetrically.
  useEffect(() => {
    if (!open) return;
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [open]);

  // Capture the previously-focused element on open, restore it on
  // close. Done in a layout-adjacent effect so it runs before the
  // user perceives the dialog mount.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move initial focus to the first focusable child (typically the
    // header's close button). `requestAnimationFrame` waits for the
    // dialog DOM to mount before querying.
    const raf = requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      const target = focusables[0] ?? root;
      target.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // Restore focus only if the previously-focused element is still
      // in the DOM. Defensive: a destroyed trigger (e.g. a removed
      // dock tab row after delete) would otherwise throw on `.focus()`.
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  // Keyboard handling: Escape closes; Tab/Shift+Tab cycle focus
  // inside the dialog only. The previous implementation only
  // handled Escape — Tab would walk into the underlying page,
  // breaking the modal contract.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
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
      } else {
        // Symmetry with the shift-Tab clamp above: ALSO recover when
        // focus has been stolen out of the dialog (iframe, external
        // browser surface, an `autofocus` on a freshly-mounted child
        // outside `root`). Without this, forward-Tab from an escaped
        // focus continued walking the page tab-order instead of
        // bouncing back into the dialog — breaking the focus-trap
        // contract the moment any non-cooperative element grabbed
        // focus.
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    downOriginRef.current = e.target === e.currentTarget ? 'backdrop' : 'dialog';
  };
  const handleBackdropMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const origin = downOriginRef.current;
    downOriginRef.current = null;
    if (!closeOnBackdrop) return;
    if (origin !== 'backdrop') return;
    if (e.target !== e.currentTarget) return;
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-surface-base/80 backdrop-blur-sm pt-20"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'elev-2 mx-4 flex max-h-[80vh] w-full flex-col overflow-hidden rounded-card',
          'border border-border-subtle/18 bg-surface-raised',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl',
          size === 'xl' && 'max-w-6xl'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between border-b px-5 py-3.5',
            chromeEdgeClassName
          )}
        >
          <h2 id={titleId} className="text-row font-semibold text-text-primary">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" strokeWidth={2.25} />
          </IconButton>
        </div>
        <div className="scrollbar-stealth flex-1 overflow-y-auto px-5 pb-5 pt-1">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
