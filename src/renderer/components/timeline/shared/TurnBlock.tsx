/**
 * TurnBlock — hybrid turn-level shell grouping one user prompt and all
 * following agent rows until the next user prompt.
 */

import { type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';

interface TurnBlockProps {
  children: ReactNode;
  /** Live run emphasis — composer-style focus glow on the turn shell. */
  live?: boolean;
  className?: string;
}

export function TurnBlock({ children, live = false, className }: TurnBlockProps) {
  return (
    <SurfaceShell
      focusGlow={live}
      className={cn('flex flex-col gap-1', className)}
    >
      {children}
    </SurfaceShell>
  );
}

/** Split derived rows into turn segments starting at each user-prompt. */
export function groupRowsIntoTurns<T extends { kind: string }>(rows: T[]): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];

  for (const row of rows) {
    if (row.kind === 'user-prompt' && current.length > 0) {
      segments.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}
