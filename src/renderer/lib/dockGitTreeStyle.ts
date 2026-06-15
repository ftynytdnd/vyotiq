/**
 * Git decoration styles for dock file tree rows (VS Code–style label + badge).
 */

import type { GitPathStatus } from '@shared/types/ipc.js';
import { cn } from './cn.js';

export function gitStatusNameClass(status: GitPathStatus | null | undefined): string {
  if (!status) return '';
  switch (status) {
    case 'M':
      return 'text-warning';
    case 'A':
      return 'text-success';
    case 'D':
      return 'text-danger/80 line-through';
    case 'U':
      return 'text-danger';
    case '?':
      return 'text-text-muted italic';
    case 'R':
      return 'text-accent';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return '';
    }
  }
}

export function gitStatusBadgeClass(status: GitPathStatus): string {
  switch (status) {
    case 'M':
      return 'bg-warning-soft text-warning-strong';
    case 'A':
      return 'bg-success-soft text-success-strong';
    case 'D':
      return 'bg-danger-soft text-danger-strong';
    case 'U':
      return 'bg-danger-soft text-danger-strong';
    case '?':
      return 'bg-chrome-hover-soft text-text-muted';
    case 'R':
      return 'bg-accent-soft text-accent';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'bg-chrome-hover-soft text-text-faint';
    }
  }
}

export function gitStatusAriaLabel(status: GitPathStatus): string {
  switch (status) {
    case 'M':
      return 'Modified';
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'U':
      return 'Unmerged';
    case '?':
      return 'Untracked';
    case 'R':
      return 'Renamed';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function gitStatusBadgeCn(status: GitPathStatus | null | undefined): string {
  if (!status) return '';
  return cn(
    'shrink-0 rounded px-1 py-px font-mono text-[9px] font-semibold uppercase leading-none tracking-wide',
    gitStatusBadgeClass(status)
  );
}
