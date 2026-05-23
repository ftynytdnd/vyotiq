/**
 * Section label row for the left dock (Workspaces / Chats).
 */

import { Eyebrow } from '../ui/Eyebrow.js';
import { cn } from '../../lib/cn.js';

interface DockSectionHeaderProps {
  label: string;
  className?: string;
}

export function DockSectionHeader({ label, className }: DockSectionHeaderProps) {
  return (
    <Eyebrow bold className={cn('px-2 pb-0.5 text-text-muted', className)}>
      {label}
    </Eyebrow>
  );
}
