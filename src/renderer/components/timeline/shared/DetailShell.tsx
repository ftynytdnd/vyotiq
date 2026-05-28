/**
 * DetailShell — nested inset panel stack for expanded timeline detail.
 * Replaces the left-border NestedDetailRail with composer-style shells.
 */

import { type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

interface DetailShellProps {
  children: ReactNode;
  /** Tailwind gap class. Defaults to `gap-1.5`. */
  gap?: string;
  className?: string;
  /** `nested` = inset shell; `flush` = tight bare stack; `flat` = spaced bare stack. */
  variant?: 'nested' | 'flush' | 'flat';
}

export function DetailShell({
  children,
  gap = 'gap-1.5',
  className,
  variant = 'nested'
}: DetailShellProps) {
  if (variant === 'flush') {
    return (
      <div className={cn('mt-0 flex flex-col gap-1', className)}>
        {children}
      </div>
    );
  }

  if (variant === 'flat') {
    return (
      <div className={cn('mt-0.5 flex flex-col', gap, className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('mt-0.5 vx-timeline-detail-shell', className)}>
      <div className={cn('flex flex-col', gap)}>{children}</div>
    </div>
  );
}
