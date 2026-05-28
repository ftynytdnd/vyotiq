/**
 * Spinner — Lucide Loader2 wrapper (replaces inline SVG).
 */
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';

interface SpinnerProps {
  className?: string;
  size?: number;
}

export function Spinner({ className, size = 12 }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      strokeWidth={2}
      className={cn('animate-spin text-text-muted', className)}
      role="status"
      aria-label="Loading"
    />
  );
}
