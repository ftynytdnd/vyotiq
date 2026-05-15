/**
 * ConfirmDialog — a controlled yes/no modal that replaces `window.confirm`.
 * Uses existing Modal + Button primitives so it inherits the stealth dark
 * theme and rounded-card shape.
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
          <Button variant={variant === 'danger' ? 'secondary' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
