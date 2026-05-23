/**
 * DetailShell — nested inset panel stack for expanded timeline detail.
 * Replaces the left-border NestedDetailRail with composer-style shells.
 */

import { type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import {
  SurfaceShell,
  surfaceShellInnerClassName
} from '../../ui/SurfaceShell.js';

interface DetailShellProps {
  children: ReactNode;
  /** Tailwind gap class. Defaults to `gap-1.5`. */
  gap?: string;
  className?: string;
}

export function DetailShell({
  children,
  gap = 'gap-1.5',
  className
}: DetailShellProps) {
  return (
    <div className={cn('mt-1', className)}>
      <SurfaceShell
        className={cn('flex flex-col', gap, surfaceShellInnerClassName('nested'))}
      >
        {children}
      </SurfaceShell>
    </div>
  );
}
