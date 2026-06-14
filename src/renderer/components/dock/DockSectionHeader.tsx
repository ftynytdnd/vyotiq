/**
 * Section label row for the left dock (workspaces rail, etc.).
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

interface DockSectionHeaderProps {
  label: string;
  className?: string;
  /** Visually hide label (kept for screen readers) when workbench chrome is active. */
  compact?: boolean;
  /** Trailing controls (Open workspace, Set path, …). */
  actions?: ReactNode;
}

export function DockSectionHeader({ label, className, compact, actions }: DockSectionHeaderProps) {
  return (
    <div
      className={cn(
        'mb-0 flex shrink-0 items-center justify-between gap-2 px-2 pb-0.5',
        compact ? 'pt-0.5' : 'pt-1.5',
        className
      )}
    >
      <span className={cn('text-meta text-text-faint', compact && 'sr-only')}>{label}</span>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}
