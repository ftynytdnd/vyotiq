import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

interface LoadingHintProps {
  message?: string;
  className?: string;
  size?: number;
}

/** Shared spinner + muted label for panels and conversation switch. */
export function LoadingHint({
  message = 'Loading…',
  className,
  size = 14
}: LoadingHintProps) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-8 text-row text-text-muted', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="shrink-0 animate-spin text-text-faint"
        size={size}
        strokeWidth={2}
        aria-hidden
      />
      <span>{message}</span>
    </div>
  );
}
