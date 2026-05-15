import { ArrowUp, Square } from 'lucide-react';
import { cn } from '../../lib/cn.js';

interface SendButtonProps {
  onClick: () => void;
  state: 'idle' | 'ready' | 'processing';
  disabled?: boolean;
}

export function SendButton({ onClick, state, disabled }: SendButtonProps) {
  const isProcessing = state === 'processing';
  const isReady = state === 'ready';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isProcessing ? 'Stop' : 'Send'}
      title={isProcessing ? 'Stop' : 'Send'}
      className={cn(
        'app-no-drag inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-inner',
        'transition-colors duration-150 disabled:cursor-not-allowed',
        isProcessing
          ? 'bg-text-primary text-surface-base hover:brightness-90'
          : isReady
            ? 'bg-text-primary text-surface-base hover:brightness-95'
            : 'bg-surface-overlay text-text-faint opacity-60'
      )}
    >
      {isProcessing ? (
        <Square className="h-2.5 w-2.5 fill-current" strokeWidth={2.25} />
      ) : (
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
      )}
    </button>
  );
}
