/**
 * Subtle marker that a timeline edit has a pending checkpoint entry.
 * Accept/Reject live in the pending panel — this dot is discoverability only.
 */

import { cn } from '../../../lib/cn.js';

interface PendingEntryDotProps {
  className?: string;
  title?: string;
}

export function PendingEntryDot({
  className,
  title = 'Awaiting review in pending changes'
}: PendingEntryDotProps) {
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-accent/75', className)}
      title={title}
      aria-label={title}
    />
  );
}
