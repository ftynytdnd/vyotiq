/**
 * ComposerDialog — mini FloatingPanel-style dialog anchored above the
 * chat composer. Used for confirms / approvals / prompts that cannot
 * fit inline at the trigger (see `InlineConfirm`).
 *
 * Layout contract (per `dialog-ux-redesign.md`):
 *   - Rendered into a designated mount point inside the chat column
 *     (provided by {@link ComposerDialogAnchor}). Width matches the
 *     composer's `contentWidth` so the dialog reads as a peer of the
 *     input it sits above.
 *   - **No backdrop** — composer remains usable while the dialog is
 *     open. Dismissal is via the X, Escape, or the explicit primary /
 *     cancel actions inside the body.
 *   - Two sizes: `compact` (auto-grow up to ~40 dvh) and `expanded`
 *     (max ~60 dvh, scrolling body for diffs).
 *   - Focus trap until dismissed; first focusable element auto-focused.
 *   - Optional `enterPrimaryRef` lets a child wire Enter → primary
 *     action by passing a ref the dialog will click on Enter.
 *   - `queueBadge` renders an "N queued" stepper next to the title for
 *     stacked composer-dialog burst flows.
 *
 * No portal — the dialog renders inline so its width matches the
 * surrounding composer column. The anchor mount point handles vertical
 * stacking (multiple dialog requests render one at a time, but
 * other ComposerDialog hosts can coexist).
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react';
import { cn } from '../../lib/cn.js';
import { bindFocusTrap, focusFirstFocusable } from '../../lib/focusTrap.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { PanelHeader } from './PanelHeader.js';

type ComposerDialogSize = 'compact' | 'expanded';

export interface ComposerDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /**
   * `compact` (default) — auto-height up to ~40 dvh.
   * `expanded` — max ~60 dvh with internal scrolling (for diffs etc.).
   */
  size?: ComposerDialogSize;
  /** Stepper badge ("Approval 2 of 5") rendered beside the title. */
  badge?: ReactNode;
  /**
   * Screen-reader announcement when the dialog opens or the queue
   * position changes (polite live region).
   */
  queueAnnouncement?: string;
  /** Header actions slot (rendered between title and X). */
  headerActions?: ReactNode;
  /**
   * Element to click when the user presses Enter outside an input.
   * Pass the primary action button's ref so confirms feel responsive.
   */
  enterPrimaryRef?: RefObject<HTMLButtonElement | null>;
  /** Disable Escape-to-close (e.g. while a request is in flight). */
  disableEscape?: boolean;
  /**
   * Soft-Escape hook for expanded dialogs. When provided and `size` is
   * `expanded`, Escape invokes this callback instead of closing.
   */
  onEscapeFromExpanded?: () => void;
  /** Custom close-button label. */
  closeLabel?: string;
  className?: string;
}

const SIZE_BODY_CLASS: Record<ComposerDialogSize, string> = {
  compact: 'max-h-[min(40dvh,360px)] overflow-y-auto',
  expanded: 'max-h-[min(60dvh,520px)] overflow-y-auto'
};

function useBlockingOverlayOpen(): boolean {
  return useAttachmentPreviewStore((s) => s.attachment !== null);
}

export function ComposerDialog({
  open,
  onClose,
  title,
  children,
  size = 'compact',
  badge,
  queueAnnouncement,
  headerActions,
  enterPrimaryRef,
  disableEscape = false,
  onEscapeFromExpanded,
  closeLabel,
  className
}: ComposerDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const blockingOverlayOpen = useBlockingOverlayOpen();
  const ariaModal = open && !blockingOverlayOpen;

  // Capture the previously-focused element so we can restore it on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (root) focusFirstFocusable(root);
    });
    return () => {
      cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return bindFocusTrap({
      getRoot: () => dialogRef.current,
      disableEscape,
      onEscape: () => {
        if (size === 'expanded' && onEscapeFromExpanded) {
          onEscapeFromExpanded();
          return;
        }
        onClose();
      }
    });
  }, [open, onClose, disableEscape, size, onEscapeFromExpanded]);

  // Enter → click the wired primary action (skipped when the user is
  // typing in a multi-line textarea so newline insertion still works).
  const onContainerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!enterPrimaryRef?.current) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement && target.type === 'text') {
        // TextField inputs forward their own Enter, so let them.
        return;
      }
      e.preventDefault();
      enterPrimaryRef.current.click();
    },
    [enterPrimaryRef]
  );

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={ariaModal ? 'true' : 'false'}
      aria-labelledby={titleId}
      data-size={size}
      onKeyDown={onContainerKeyDown}
      className={cn(
        'vx-composer-dialog vyotiq-composer-dialog-enter mb-2 flex w-full flex-col',
        className
      )}
    >
      {queueAnnouncement ? (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {queueAnnouncement}
        </div>
      ) : null}
      <PanelHeader
        title={title}
        titleId={titleId}
        badge={badge}
        actions={headerActions}
        onClose={onClose}
        {...(closeLabel ? { closeLabel } : {})}
      />
      <div className={cn('vx-composer-dialog-body p-3', SIZE_BODY_CLASS[size])}>
        {children}
      </div>
    </div>
  );
}
