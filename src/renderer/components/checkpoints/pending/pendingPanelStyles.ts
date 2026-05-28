/**
 * Shared layout + surface tokens for the pending-changes panel.
 */

import { cn } from '../../../lib/cn.js';
import { chromeMeterClassName, surfaceShellClassName } from '../../ui/SurfaceShell.js';

/** Aligned columns: chevron · path · stats · actions */
export const pendingFileRowGridTemplate =
  'grid-cols-[1.25rem_minmax(0,1fr)_4rem_minmax(0,auto)]';

/** Outer timeline-tail shell. */
export function pendingPanelShellClassName(gateOn: boolean): string {
  return cn(
    surfaceShellClassName,
    'flex w-full min-w-0 flex-col overflow-hidden',
    gateOn && 'bg-accent-soft/[0.04]'
  );
}

export const pendingPanelHeaderClassName = cn(
  'flex w-full min-w-0 flex-col gap-1 border-b border-border-subtle/15 px-2 py-1.5'
);

export const pendingPanelTitleRowClassName = cn(
  'flex w-full min-w-0 items-center gap-2'
);

export const pendingPanelTitleButtonClassName = cn(
  'app-no-drag flex min-w-0 flex-1 items-center gap-2 rounded-inner px-0.5 py-0.5 text-left',
  'transition-colors duration-150 hover:bg-surface-hover/30'
);

export const pendingPanelToolbarRowClassName = cn(
  'flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6'
);

export const pendingPanelMetaRowClassName = cn(
  'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-text-muted'
);

export const pendingPanelFiltersRowClassName = cn(
  'flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-border-subtle/10 pt-1.5 pl-6'
);

export const pendingPanelListClassName = cn(
  'flex w-full min-w-0 flex-col divide-y divide-border-subtle/12'
);

export const pendingPanelListScrollClassName = cn(
  'scrollbar-stealth max-h-[min(24vh,14rem)] min-h-0 w-full min-w-0 overflow-y-auto'
);

export const pendingPanelEmptyClassName = cn(
  'px-3 py-4 text-row text-text-muted'
);

export const pendingPanelCountChipClassName = cn(
  chromeMeterClassName('shrink-0 px-1.5 py-px tabular-nums text-text-secondary')
);

export function pendingGatePillClassName(gateOn: boolean): string {
  return cn(
    'inline-flex shrink-0 items-center rounded-inner px-1.5 py-px text-meta',
    gateOn
      ? 'bg-warning-soft/25 text-warning-strong'
      : 'border border-border-subtle/25 text-text-faint'
  );
}

export function pendingReviewBlockPillClassName(): string {
  return cn(
    'inline-flex shrink-0 items-center rounded-inner px-1.5 py-px text-meta',
    'bg-danger-soft/25 text-danger-strong'
  );
}

export function pendingReviewDecisionBadgeClassName(
  decision: 'approve' | 'request_changes'
): string {
  // `chromeMeterClassName` is a FUNCTION exported from `SurfaceShell.tsx`
  // and MUST be invoked. Passing the bare reference to `cn(...)` silently
  // strips the badge of `inline-flex h-6 items-center rounded-inner
  // bg-surface-overlay font-mono text-meta` (clsx coerces function args
  // to ""). The trailing `'shrink-0 font-mono text-meta'` only happened
  // to keep the chip *partially* readable because two of its tokens
  // overlapped the lost surface — the rounded fill and 24-px alignment
  // were silently missing. Match the call shape used elsewhere in this
  // file (line ~59) and at every other consumer.
  return cn(
    chromeMeterClassName('shrink-0'),
    decision === 'approve'
      ? 'text-success-strong'
      : 'text-danger-strong'
  );
}

export const pendingFileRowGridClassName = cn(
  'grid w-full min-w-0 items-center gap-x-2 px-2 py-1 text-left',
  pendingFileRowGridTemplate,
  'transition-colors duration-150 hover:bg-surface-hover/35'
);

export const pendingFileRowNestedGridClassName = cn(
  pendingFileRowGridClassName,
  'border-l border-border-subtle/25 py-0.5 pl-3 pr-2'
);

export const pendingRunGroupHeaderClassName = cn(
  pendingFileRowGridClassName,
  'border-b border-border-subtle/10 text-meta uppercase tracking-wide text-text-faint'
);

export const pendingExpandButtonClassName = cn(
  'app-no-drag flex shrink-0 items-center justify-center rounded-inner p-0.5',
  'text-text-muted transition-colors duration-150',
  'hover:bg-surface-hover/50 hover:text-text-primary'
);

export const pendingDiffInsetClassName = cn(
  'mx-2 mb-1 border border-border-subtle/12 bg-surface-raised/10'
);

export function pendingKindDotClassName(
  kind: 'modify' | 'create' | 'delete'
): string {
  return cn(
    'h-1.5 w-1.5 shrink-0 rounded-full',
    kind === 'create' && 'bg-accent',
    kind === 'delete' && 'bg-danger',
    kind === 'modify' && 'bg-text-faint/80'
  );
}

