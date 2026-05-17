/**
 * ConfirmDialog — a controlled yes/no modal that replaces `window.confirm`.
 *
 * Variant routing:
 *   - `primary` — confirm button uses `Button variant="primary"`. Used
 *     for affirmative actions ("Apply", "Continue").
 *   - `danger`  — confirm button uses `Button variant="danger"` (the
 *     destructive ghost). The earlier wiring routed `danger` to
 *     `secondary` on the assumption a calmer button would discourage
 *     misclicks, but that suppressed the destructive signal entirely
 *     and made the cancel + confirm buttons read as equivalent. The
 *     real safeguard is the `confirm` step itself, not a tone tweak —
 *     so the destructive variant now actually paints destructive.
 *
 * Cancel always renders as `ghost` so the dismissive path stays the
 * quiet one regardless of the destructive intent.
 */

import { Modal } from './Modal.js';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="md">
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-body leading-relaxed text-text-secondary">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
