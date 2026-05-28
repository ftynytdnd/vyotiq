/**
 * Shared layout + surface tokens for the pending-changes panel.
 * Aligned with Vyotiq UI semantic tokens.
 */

import { cn } from '../../../lib/cn.js';
import {
  chromeMeterClassName,
  chromeNoMatchesClassName,
  chromeStatusPillClassName,
  appComposerShellClassName
} from '../../ui/SurfaceShell.js';

/** Aligned columns: chevron · path · stats · actions */
export const pendingFileRowGridTemplate =
  'grid-cols-[1.25rem_minmax(0,1fr)_4rem_minmax(0,auto)]';

/** Outer timeline-tail shell — flat composer surface. */
export function pendingPanelShellClassName(gateOn: boolean): string {
  return cn(
    appComposerShellClassName,
    'flex w-full min-w-0 flex-col overflow-hidden',
    gateOn && 'bg-danger-soft'
  );
}

export const pendingPanelHeaderClassName = cn(
  'flex w-full min-w-0 flex-col gap-0.5',
  'px-2 py-1'
);

export const pendingPanelTitleRowClassName = cn(
  'flex w-full min-w-0 items-center gap-1.5'
);

export const pendingPanelTitleButtonClassName = cn(
  'app-no-drag flex min-w-0 flex-1 items-center gap-2 rounded-line px-0.5 py-0.5 text-left',
  'transition-[background,color] duration-160 hover:bg-chrome-hover'
);

export const pendingPanelToolbarRowClassName = cn(
  'flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 pl-5'
);

export const pendingPanelMetaRowClassName = cn(
  'flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-text-muted'
);

export const pendingPanelFiltersRowClassName = cn(
  'flex w-full min-w-0 flex-wrap items-center gap-1.5',
  'pt-1 pl-5'
);

export const pendingPanelListClassName = cn(
  'flex w-full min-w-0 flex-col gap-0.5'
);

export const pendingPanelListScrollClassName = cn(
  'scrollbar-stealth max-h-[min(20vh,12rem)] min-h-0 w-full min-w-0 overflow-y-auto'
);

/** @deprecated Use {@link chromeNoMatchesClassName} — kept for pending panel imports. */
export const pendingPanelEmptyClassName = chromeNoMatchesClassName;

export const pendingPanelCountChipClassName = cn(
  chromeMeterClassName('shrink-0 px-1.5 py-px tabular-nums text-text-secondary')
);

export function pendingGatePillClassName(gateOn: boolean): string {
  return chromeStatusPillClassName(gateOn ? 'warning' : 'neutral', 'shrink-0');
}

/** File row — `vx-memory-list-item` hover rhythm. */
export const pendingFileRowGridClassName = cn(
  'grid w-full min-w-0 items-center gap-x-1.5 px-2 py-1 text-left',
  pendingFileRowGridTemplate,
  'rounded-line transition-[background,color] duration-160',
  'hover:bg-chrome-hover'
);

export const pendingFileRowNestedGridClassName = cn(
  pendingFileRowGridClassName,
  'border-l border-border-subtle/22 py-0.5 pl-3 pr-2'
);

export const pendingRunGroupHeaderClassName = cn(
  pendingFileRowGridClassName,
  'text-meta text-text-faint'
);

export const pendingExpandButtonClassName = cn(
  'app-no-drag vx-btn vx-btn-quiet flex shrink-0 items-center justify-center p-0.5'
);

/** Diff inset — `vx-textarea` surface rhythm. */
export const pendingDiffInsetClassName = cn(
  'mx-2 mb-1 overflow-hidden rounded-inner',
  'border border-border-subtle/28',
  'bg-surface-base/35'
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

/** Column header row for pending file list. */
export const pendingListHeaderClassName = cn(
  'sticky top-0 z-[1] grid items-center gap-x-1.5',
  'bg-surface-base/92 px-2 py-0.5 backdrop-blur-[8px]',
  pendingFileRowGridTemplate,
  'vx-field-label mb-0'
);
