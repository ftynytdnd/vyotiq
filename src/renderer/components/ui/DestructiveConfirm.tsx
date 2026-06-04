/**
 * DestructiveConfirm — single entry point for destructive
 * confirmations. Routes to {@link InlineConfirm} when the call site
 * can replace a row in place, or to {@link ComposerDialog} for cases
 * where inline does not fit (compact panel above the composer).
 *
 * Inline destructive flows default to a two-step pattern (Continue →
 * Delete) per dialog-ux-redesign round 3.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { playDestructiveWarningSound } from '../../lib/destructiveSound.js';
import { Button } from './Button.js';
import { ComposerDialog } from './ComposerDialog.js';
import { ComposerDialogPortal } from './ComposerDialogAnchor.js';
import { InlineConfirm } from './InlineConfirm.js';
import { ShellCaption, ShellFieldActions } from './ShellSection.js';

interface CommonProps {
  /** Whether the confirm is currently open. */
  open: boolean;
  /** Confirm-button label (final step / single-step). Defaults to "Delete". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** First-step label when `twoStep` is enabled. Defaults to "Continue". */
  continueLabel?: string;
  /**
   * Two-step destructive: Continue arms, second click confirms.
   * Inline variant defaults to `true`; composer defaults to `false`.
   */
  twoStep?: boolean;
  /** Confirm-button tone. Defaults to destructive danger. */
  tone?: 'danger' | 'primary';
  /** Disable confirm temporarily (e.g. while a request is in flight). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface InlineVariantProps extends CommonProps {
  variant: 'inline';
  /** Question copy ("Remove this chat?"). */
  question: ReactNode;
  /** Optional muted context (e.g. the chat title). */
  context?: ReactNode;
  className?: string;
}

interface ComposerVariantProps extends CommonProps {
  variant: 'composer';
  /** Title rendered in the dialog header. */
  title: ReactNode;
  /** Body copy describing the destructive action. */
  message: ReactNode;
  /**
   * When true, portals above the full viewport (legacy elevated confirm).
   * Shell tool approvals default to false so the dialog sits in the
   * composer column and does not obscure delegation streams.
   */
  elevated?: boolean;
  /** Optional muted hint below the message (e.g. timeout guidance). */
  hint?: ReactNode;
}

export type DestructiveConfirmProps = InlineVariantProps | ComposerVariantProps;

export function DestructiveConfirm(props: DestructiveConfirmProps) {
  if (!props.open) return null;
  if (props.variant === 'inline') {
    const {
      question,
      context,
      confirmLabel,
      cancelLabel,
      continueLabel,
      twoStep = true,
      tone,
      busy,
      onConfirm,
      onCancel,
      className
    } = props;
    return (
      <InlineConfirm
        question={question}
        twoStep={twoStep}
        {...(context !== undefined ? { context } : {})}
        {...(confirmLabel !== undefined ? { confirmLabel } : {})}
        {...(cancelLabel !== undefined ? { cancelLabel } : {})}
        {...(continueLabel !== undefined ? { continueLabel } : {})}
        {...(tone !== undefined ? { variant: tone } : {})}
        {...(busy !== undefined ? { busy } : {})}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }
  return <DestructiveComposerDialog {...props} />;
}

function DestructiveComposerDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  continueLabel = 'Continue',
  twoStep = false,
  tone = 'danger',
  busy = false,
  elevated = false,
  hint,
  onConfirm,
  onCancel
}: ComposerVariantProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!twoStep) {
      playDestructiveWarningSound();
      return;
    }
    setArmed(false);
  }, [title, message, twoStep]);

  useEffect(() => {
    if (twoStep && armed) playDestructiveWarningSound();
  }, [twoStep, armed]);

  const handlePrimary = () => {
    if (twoStep && !armed) {
      setArmed(true);
      return;
    }
    onConfirm();
  };

  const primaryLabel = twoStep && !armed ? continueLabel : confirmLabel;

  return (
    <ComposerDialogPortal elevated={elevated}>
      <ComposerDialog
        open
        onClose={() => {
          setArmed(false);
          onCancel();
        }}
        title={title}
        size="compact"
        enterPrimaryRef={primaryRef}
        disableEscape={busy}
      >
        <div className="flex flex-col gap-3">
          <ShellCaption className="whitespace-pre-wrap text-body leading-relaxed text-text-secondary">
            {message}
          </ShellCaption>
          {hint ? (
            <ShellCaption className="text-meta text-text-faint">{hint}</ShellCaption>
          ) : null}
          <ShellFieldActions className="!mt-0">
            <Button
              variant="ghost"
              onClick={() => {
                setArmed(false);
                onCancel();
              }}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
            <Button
              ref={primaryRef}
              variant={twoStep && !armed ? 'secondary' : tone}
              onClick={handlePrimary}
              disabled={busy}
            >
              {primaryLabel}
            </Button>
          </ShellFieldActions>
        </div>
      </ComposerDialog>
    </ComposerDialogPortal>
  );
}
