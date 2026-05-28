/**
 * SurfaceShell — canonical bordered inset shell matching composer/dock footer
 * chrome. Centralizes the long `cn(...)` strings used across ChatFooter,
 * timeline rows, and secondary panels.
 */

import {
  type ElementType,
  type HTMLAttributes,
  type ReactNode
} from 'react';
import { cn } from '../../lib/cn.js';

export type SurfaceShellPadding = 'none' | 'compact' | 'content' | 'nested';

/** Base shell — composer footer and panels that need a distinct container. */
export const surfaceShellClassName = cn(
  'overflow-hidden rounded-inner',
  'border border-border-subtle/18 bg-surface-raised/10',
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.025)]'
);

/** Optional focus-within glow for interactive shells (composer input area). */
export const surfaceShellFocusClassName = cn(
  'transition-[border-color,box-shadow] duration-150',
  'focus-within:border-border-subtle/35',
  'focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,255,255,0.02)]'
);

const PADDING_CLASS: Record<SurfaceShellPadding, string> = {
  none: '',
  compact: 'px-2 py-1',
  content: 'px-3 py-2',
  nested: 'px-2.5 py-1.5'
};

export function surfaceShellInnerClassName(
  padding: SurfaceShellPadding = 'none'
): string {
  return PADDING_CLASS[padding];
}

/** List container inside a shell (checkpoints, inspector lists). */
export const surfaceListClassName = cn(
  surfaceShellClassName,
  'flex flex-col gap-0.5 overflow-y-auto p-1'
);

/** Hairline edge between chrome regions (dock, footer, secondary zone). */
export const chromeEdgeClassName = 'border-border-subtle/10';

/** Floating menu / popover panel (`elev-1`). */
export const chromePopoverPanelClassName = cn('elev-1 rounded-card bg-surface-overlay');

/** Large picker panel (`elev-2`, model picker). */
export const chromeElev2PanelClassName = cn('elev-2 rounded-card bg-surface-overlay');

/**
 * Ghost toolbar control — transparent at rest.
 *
 * Fill only when `active` (open menu, selected tab, attachments picked, …)
 * or on hover. Do not add resting `bg-surface-overlay` here; use
 * {@link chromeMeterClassName} for persistent gauge chips (token pill).
 */
export function chromePillClassName(active?: boolean): string {
  return cn(
    'app-no-drag inline-flex h-6 items-center justify-center rounded-inner',
    'text-text-muted transition-colors duration-150',
    'hover:bg-surface-hover hover:text-text-primary',
    active && 'bg-surface-hover text-text-primary'
  );
}

/** Persistent compact chip (token gauge, count badges) — always has a fill. */
export function chromeMeterClassName(className?: string): string {
  return cn(
    'inline-flex h-6 items-center rounded-inner bg-surface-overlay font-mono text-meta',
    className
  );
}

/** Selected list/tab row (dock, strip tabs, inspector). */
export const chromeTabActiveClassName = 'bg-surface-hover text-text-primary';

/** Idle list/tab row — transparent until hover. */
export const chromeTabIdleClassName =
  'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary';

/** Filter chip (run id, path filters) — accent when selected. */
export function chromeFilterChipClassName(active?: boolean): string {
  return cn(
    'rounded-inner px-1.5 py-0.5 transition-colors duration-150',
    active
      ? 'bg-accent-soft/60 text-accent'
      : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
  );
}

/** Inset tray for segmented controls (binary mode toggles). */
export function chromeSegmentedTrayClassName(compact = false): string {
  return compact
    ? 'inline-flex items-center rounded-inner bg-surface-overlay/30 p-0.5'
    : 'flex overflow-hidden rounded-inner bg-surface-base';
}

/** Compact search/filter row — tint only on focus. */
export const chromeSearchRowClassName = cn(
  'flex items-center gap-1 rounded-inner border border-border-subtle/40 px-2 py-0.5 text-meta',
  'focus-within:border-border-subtle focus-within:bg-surface-hover/40'
);

/** Static status badge (Undone, attribution) — border, no fill. */
export const chromeBadgeClassName = cn(
  'inline-flex items-center rounded-inner border border-border-subtle/25 px-1.5 py-0.5 text-meta text-text-muted'
);

/** Compact ghost action on timeline rows (Inspect, Undo). */
export const chromeRowActionClassName = cn(
  'app-no-drag inline-flex items-center gap-0.5 rounded-inner px-1.5 py-0.5 text-meta',
  'text-text-secondary transition-colors duration-150',
  'hover:bg-surface-hover hover:text-text-primary'
);

/** Inline placeholder / empty copy — border, no fill. */
export const chromeInsetNoteClassName = cn(
  'rounded-inner border border-border-subtle/20 px-3 py-2 text-row text-text-faint'
);

/** Progress bar track (context breakdown, meters). */
export const chromeProgressTrackClassName = cn(
  'relative h-1.5 flex-1 overflow-hidden rounded-pill',
  'border border-border-subtle/15 bg-surface-raised/25'
);

/** Settings / secondary-zone card shell (list panes, empty states). */
export const chromeSettingsCardClassName = cn(
  'rounded-card border border-border-subtle/18 bg-surface-raised/10'
);

/** Settings override row wash. */
export const chromeSettingsInsetRowClassName = cn(
  'rounded-inner bg-surface-base/30 px-3 py-2'
);

/** Ghost text button in settings rows (Reset, secondary actions). */
export const chromeGhostRowButtonClassName = cn(
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-inner px-2.5 text-row',
  'text-text-muted transition-colors duration-150',
  'hover:bg-surface-hover hover:text-text-primary'
);

/** Square icon-only ghost action (sub-agent trace, row toolbars). */
export const chromeIconActionClassName = cn(
  chromePillClassName(false),
  'w-6 text-text-faint'
);

/** Monospace code / diff body surface. */
export function chromeCodeSurfaceClassName(className?: string): string {
  return cn(
    'scrollbar-stealth overflow-auto rounded-inner bg-surface-overlay font-mono',
    className
  );
}

/** Raised code panel (read tool with line gutter). */
export const chromeCodePanelClassName = cn(
  'scrollbar-stealth flex overflow-auto rounded-inner bg-surface-raised'
);

/** Sticky line-number gutter inside a code panel. */
export const chromeCodeGutterClassName = cn(
  'sticky left-0 select-none border-r border-border-subtle/40 bg-surface-overlay px-2 py-1.5 font-mono text-meta text-text-faint'
);

/** Sticky diff hunk header on code surface. */
export const chromeCodeStickyHeaderClassName = cn(
  'sticky top-0 z-[1] border-b border-border-subtle/30 bg-surface-overlay/90 px-1 font-mono text-meta text-text-faint backdrop-blur-sm'
);

/** Soft scroll list inside modals (revert file list). */
export const chromeScrollListClassName = cn(
  'scrollbar-stealth overflow-y-auto rounded-inner border border-border-subtle/15 bg-surface-raised/15'
);

/** Floating toolbar on code/diff (navigator, copy cluster). */
export const chromeFloatingToolbarClassName = cn(
  'rounded-inner border border-border-subtle/40 bg-surface-raised/80 px-0.5 py-0.5 backdrop-blur-sm'
);

/** Composer attachment / chip tray — light border, no solid box. */
export const chromeChipTrayClassName = cn(
  'rounded-inner border border-border-subtle/15 bg-surface-raised/40 px-2 py-1'
);

/** Faint log-line wash (agent thoughts, status). */
export const chromeLogWashClassName = 'rounded-inner bg-surface-overlay/20';

/** Hover-revealed square icon (copy on code blocks). */
export function chromeRevealIconActionClassName(className?: string): string {
  return cn(
    chromeIconActionClassName,
    'opacity-0 transition-opacity duration-150 focus:opacity-100',
    className
  );
}

export type ChromeStatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

/** Semantic status pill (sub-agent, file kind, envelope status). */
export function chromeStatusPillClassName(
  tone: ChromeStatusTone,
  className?: string
): string {
  const toneClass =
    tone === 'success'
      ? 'bg-success-soft text-success'
      : tone === 'warning'
        ? 'bg-warning-soft text-warning'
        : tone === 'danger'
          ? 'bg-danger-soft text-danger'
          : tone === 'accent'
            ? 'bg-accent-soft text-accent'
            : 'border border-border-subtle/25 text-text-muted';
  return cn(
    'inline-flex h-6 items-center rounded-inner px-1.5 py-0.5 text-meta font-medium capitalize',
    toneClass,
    className
  );
}

/** Checkpoint / history file-kind badge. */
export function chromeFileKindBadgeClassName(
  kind: 'create' | 'delete' | 'modify'
): string {
  return chromeStatusPillClassName(
    kind === 'create' ? 'success' : kind === 'delete' ? 'danger' : 'neutral',
    'shrink-0 font-mono uppercase'
  );
}

/** Square icon-only variant of {@link chromePillClassName}. */
export function chromeIconPillClassName(active?: boolean): string {
  return cn(chromePillClassName(active), 'w-6 shrink-0');
}

export interface SurfaceShellProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  focusGlow?: boolean;
  padding?: SurfaceShellPadding;
  padded?: boolean;
  className?: string;
}

export function SurfaceShell({
  as: Tag = 'div',
  children,
  focusGlow = false,
  padding = 'none',
  padded = false,
  className,
  type,
  ...rest
}: SurfaceShellProps) {
  const shellClass = cn(
    'surface-shell',
    surfaceShellClassName,
    focusGlow && cn('surface-shell-focus', surfaceShellFocusClassName),
    className
  );
  const tagProps =
    Tag === 'button'
      ? { type: type ?? 'button', ...rest }
      : rest;

  if (padded && padding !== 'none') {
    return (
      <Tag className={shellClass} {...tagProps}>
        <div className={surfaceShellInnerClassName(padding)}>{children}</div>
      </Tag>
    );
  }

  return (
    <Tag className={shellClass} {...tagProps}>
      {children}
    </Tag>
  );
}
