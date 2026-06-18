import { ArrowUp } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';

interface SendButtonProps {
  onClick: () => void;
  state: 'idle' | 'ready' | 'processing';
  disabled?: boolean;
  className?: string;
  /** Overrides default Send / Steer label when set. */
  actionLabel?: string;
}

export function SendButton({ onClick, state, disabled, className, actionLabel }: SendButtonProps) {
  const isReady = state === 'ready';
  const label = actionLabel ?? 'Send';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'vx-btn app-no-drag h-6 w-6 shrink-0 px-0',
        'disabled:cursor-not-allowed',
        className,
        isReady ? 'vx-btn-accent-fill' : 'vx-btn-quiet'
      )}
    >
      <ArrowUp className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
    </button>
  );
}
