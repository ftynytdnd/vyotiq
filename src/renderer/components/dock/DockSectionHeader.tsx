/**
 * Section label row for the left dock (Workspaces / Chats).
 */

import { cn } from '../../lib/cn.js';

interface DockSectionHeaderProps {
  label: string;
  className?: string;
}

export function DockSectionHeader({ label, className }: DockSectionHeaderProps) {
  return (
    <div className={cn('mb-0 shrink-0 px-2 pt-1.5 pb-0.5 text-meta text-text-faint', className)}>
      {label}
    </div>
  );
}
