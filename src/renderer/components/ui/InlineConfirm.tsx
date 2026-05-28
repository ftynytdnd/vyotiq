/**
 * InlineConfirm — row-level destructive confirm. Replaces the row's
 * normal contents with a compact "muted title + question + Cancel +
 * Action" strip while the user decides. No backdrop, no portal —
 * scroll and the rest of the app stay reachable.
 *
 * Click-away semantics (per `dialog-ux-redesign.md`):
 *   - A click *anywhere outside* the row's DOM subtree cancels the
 *     confirm (matches the user's "click anywhere in app" choice).
 *   - Escape also cancels.
 *   - Clicking the composer dismisses inline confirms (documented UX).
 *   - The trigger that opened the confirm is owned by the parent
 *     component — InlineConfirm itself is the *replacement* row.
 *
 * Two-step destructive (round 3):
 *   - Step 1: Continue (arms the confirm, plays warning sound)
 *   - Step 2: Delete / Remove (executes `onConfirm`)
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { playDestructiveWarningSound } from '../../lib/destructiveSound.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from './Button.js';

export interface InlineConfirmProps {
  /** Question copy ("Remove this chat?"). */
  question: ReactNode;
  /** Optional muted context (e.g. the chat title) shown before the question. */
  context?: ReactNode;
  /** Confirm-button label on the final step. Defaults to "Delete". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Label for the first step when `twoStep` is enabled. Defaults to "Continue". */
  continueLabel?: string;
  /**
   * Two-step flow: first click arms (Continue), second click executes
   * (`confirmLabel`). Defaults to `false` — opt in via DestructiveConfirm.
   */
  twoStep?: boolean;
  /** Visual emphasis of the confirm action. */
  variant?: 'danger' | 'primary';
  /** Disable confirm temporarily (e.g. while a request is in flight). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
  /** Override the role attribute (default `group` keeps it semantically light). */
  role?: string;
  /** Aria label for screen readers (defaults to the question). */
  ariaLabel?: string;
  /**
   * Brief toast when the user dismisses via click-away (not Cancel /
   * Escape). `true` uses `"${confirmLabel} cancelled"`; pass a string
   * to override. `false` disables the toast.
   */
  clickAwayToast?: boolean | string;
}

export function InlineConfirm({
  question,
  context,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  continueLabel = 'Continue',
  twoStep = false,
  variant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  className,
  role = 'group',
  ariaLabel,
  clickAwayToast = true
}: InlineConfirmProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);

  // Reset armed state whenever the parent closes and re-opens the row.
  useEffect(() => {
    setArmed(false);
  }, [question, context, twoStep]);

  const dismiss = useCallback(() => {
    setArmed(false);
    onCancel();
  }, [onCancel]);

  const notifyClickAwayCancel = useCallback(() => {
    if (clickAwayToast === false) return;
    const message =
      typeof clickAwayToast === 'string'
        ? clickAwayToast
        : `${confirmLabel} cancelled`;
    useToastStore.getState().show(message, 'info');
  }, [clickAwayToast, confirmLabel]);

  const handlePrimary = useCallback(() => {
    if (twoStep && !armed) {
      setArmed(true);
      playDestructiveWarningSound();
      return;
    }
    onConfirm();
  }, [twoStep, armed, onConfirm]);

  const primaryLabel = twoStep && !armed ? continueLabel : confirmLabel;
  const primaryVariant =
    twoStep && !armed ? 'secondary' : variant === 'danger' ? 'danger' : 'primary';

  // Click-away + Escape cancel. We fire on `pointerdown` so the cancel
  // beats any subsequent click on the original trigger (the trash icon
  // would otherwise re-open the confirm immediately on the same gesture).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      notifyClickAwayCancel();
      dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
      if (e.key === 'Enter' && twoStep && armed) {
        const root = rootRef.current;
        const active = document.activeElement;
        if (root && active && root.contains(active)) {
          e.preventDefault();
          onConfirm();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [dismiss, notifyClickAwayCancel, twoStep, armed, onConfirm]);

  const label =
    ariaLabel ??
    (typeof question === 'string'
      ? question
      : 'Confirm action');

  return (
    <div
      ref={rootRef}
      role={role}
      aria-label={label}
      data-inline-confirm="true"
      data-inline-confirm-armed={twoStep && armed ? 'true' : undefined}
      className={cn(
        'vx-inline-confirm flex min-w-0 items-center gap-2 px-1.5 py-0.5',
        className
      )}
    >
      {context ? (
        <span className="min-w-0 truncate text-row text-text-faint" aria-hidden>
          {context}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-row text-text-secondary">
        {question}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={dismiss}
        disabled={busy}
      >
        {cancelLabel}
      </Button>
      <Button
        size="sm"
        variant={primaryVariant}
        onClick={handlePrimary}
        disabled={busy}
        autoFocus
      >
        {primaryLabel}
      </Button>
    </div>
  );
}
