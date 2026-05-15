/**
 * PromptDialog — a controlled text-input modal that replaces `window.prompt`.
 * Stealth dark theme via Modal + Button + inline input. Submits on Enter,
 * cancels on Escape (handled by Modal).
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { TextField } from './TextField.js';

export interface PromptDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title = 'Enter a value',
  message,
  placeholder,
  initialValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  validate,
  onSubmit,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setErr(null);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, initialValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (validate) {
      const message = validate(trimmed);
      if (message) {
        setErr(message);
        return;
      }
    }
    onSubmit(trimmed);
  };

  return (
    <Modal open={open} onClose={onCancel} title={title} size="md">
      <div className="space-y-3">
        {message && (
          <p className="whitespace-pre-wrap text-body leading-relaxed text-text-secondary">{message}</p>
        )}
        <TextField
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (err) setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          size="lg"
          tone="base"
          className="w-full"
        />
        {err && <div className="text-row text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={submit} disabled={value.trim().length === 0}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
