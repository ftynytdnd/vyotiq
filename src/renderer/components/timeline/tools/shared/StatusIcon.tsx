/**
 * Compact status glyph used at the right edge of every tool invocation row.
 *   null  → spinning loader (tool is still running)
 *   true  → success check
 *   false → failure cross
 */

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../../lib/cn.js';

interface StatusIconProps {
  ok: boolean | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusIcon({ ok, size = 'md', className }: StatusIconProps) {
  const box = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  if (ok === null) {
    return (
      <Loader2
        className={cn('shrink-0 animate-spin text-accent', box, className)}
        strokeWidth={2.25}
      />
    );
  }
  if (ok === true) {
    return (
      <CheckCircle2
        className={cn('shrink-0 text-success', box, className)}
        strokeWidth={2.25}
      />
    );
  }
  return (
    <XCircle
      className={cn('shrink-0 text-danger', box, className)}
      strokeWidth={2.25}
    />
  );
}
