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
const surfaceShellClassName = 'surface-shell';

/** Optional focus-within glow for interactive shells (composer input area). */
const surfaceShellFocusClassName = 'surface-shell-focus';

const PADDING_CLASS: Record<SurfaceShellPadding, string> = {
  none: '',
  compact: 'px-1.5 py-0.5',
  content: 'px-2.5 py-1.5',
  nested: 'px-2 py-1'
};

export function surfaceShellInnerClassName(
  padding: SurfaceShellPadding = 'none'
): string {
  return PADDING_CLASS[padding];
}

/** Floating menu / popover panel (Vyotiq UI). */
export const chromePopoverPanelClassName = 'vx-popover-panel';

/**
 * Ghost toolbar control — transparent at rest.
 *
 * Fill only when `active` (open menu, selected tab, attachments picked, …)
 * or on hover. Do not add resting `bg-surface-overlay` here; use
 * {@link chromeMeterClassName} for persistent gauge chips (token pill).
 */
export function chromePillClassName(active?: boolean): string {
  return cn(
    'app-no-drag vx-btn vx-btn-quiet inline-flex h-6 items-center justify-center px-1.5',
    active && 'bg-chrome-hover-soft text-text-primary'
  );
}

/** Composer / dock toolbar control — ghost at rest, soft fill when active. */
export function chromeToolbarButtonClassName(active?: boolean): string {
  return cn('vx-btn vx-btn-quiet app-no-drag', active && 'bg-chrome-hover-soft text-text-primary');
}

/** Persistent compact chip (token gauge, count badges) — always has a fill. */
export function chromeMeterClassName(className?: string): string {
  return cn(
    'inline-flex h-6 items-center rounded-inner bg-surface-overlay font-mono text-meta',
    className
  );
}

/** Selected list/tab row (dock, strip tabs, settings). */
export const chromeTabActiveClassName = 'vx-tab-pill-active';

/** Idle list/tab row — transparent until hover. */
export const chromeTabIdleClassName = 'vx-tab-pill-idle';

/** Filter chip (run id, path filters) — accent when selected. */
export function chromeFilterChipClassName(active?: boolean): string {
  return cn(
    'vx-filter-chip',
    active
      ? 'bg-accent-soft/60 text-accent'
      : undefined
  );
}

/** Inset tray for segmented controls (Vyotiq UI `vx-segment`). */
export function chromeSegmentedTrayClassName(compact = false): string {
  return compact ? 'vx-segment inline-flex' : 'vx-segment vx-segment-fluid flex w-full';
}

/** Static status badge (Undone, attribution) — border, no fill. */
export const chromeBadgeClassName = cn(
  'inline-flex items-center rounded-inner border border-border-subtle/25 px-1.5 py-0.5 text-meta text-text-muted'
);

/** Compact ghost action on timeline rows (Inspect, Undo). */
export const chromeRowActionClassName = cn('app-no-drag vx-timeline-action');

/** Inline placeholder / empty copy — border, no fill. */
export const chromeInsetNoteClassName = cn(
  'rounded-inner border border-border-subtle/20 px-3 py-2 text-row text-text-faint'
);

/** Progress bar track (context breakdown, meters). */
export const chromeProgressTrackClassName = cn(
  'relative h-1.5 flex-1 overflow-hidden rounded-pill',
  'border border-border-subtle/15 bg-surface-raised/25'
);

/** Settings / secondary-zone list shell (Vyotiq UI section body rhythm). */
export const chromeSettingsCardClassName = 'vx-section-body rounded-none border-0 bg-transparent p-0';

/** List-empty body copy inside settings lists. */
export const chromeListEmptyBodyClassName = 'vx-row vx-caption py-4 text-text-muted';

/** Secondary-zone list empty (e.g. settings providers). */
export const chromeListEmptyClassName = cn(
  chromeSettingsCardClassName,
  chromeListEmptyBodyClassName
);

/** Filtered-empty copy inside a populated list (model filter, dock search). */
export const chromeNoMatchesClassName = cn(
  'px-2.5 py-2 text-row text-text-muted'
);

/** Horizontal inset matching the dialog body padding. */
const secondaryZonePanelInsetXClassName = 'px-[clamp(0.875rem,3vw,1rem)]';

/** Settings tab strip wrapper (Vyotiq UI tab bar supplies the edge). */
export const secondaryZoneTabStripClassName = cn(
  'mb-0 shrink-0 min-w-0',
  secondaryZonePanelInsetXClassName
);

/** Vyotiq UI panel chrome (secondary zone PanelFrame). */
export const appPanelFrameClassName = 'vx-panel-frame flex h-full min-h-0 flex-col';
/** Dialog overlay — content-sized height (no viewport stretch). */
export const appDialogFrameClassName =
  'vx-panel-frame flex h-auto max-h-[80vh] min-h-0 w-full flex-col';
export const appPanelHeadClassName = 'vx-panel-head app-no-drag';
/** Dialog body — grows with content up to frame max-height. */
export const appDialogBodyClassName =
  'vx-panel-body scrollbar-stealth min-h-0 shrink-0 overflow-y-auto';

/** Composer footer shell (ChatFooter). */
export const appComposerShellClassName = 'vx-composer-shell';

/** Composer textarea inside {@link appComposerShellClassName}. */
export const appComposerTextareaClassName = 'vx-composer-textarea scrollbar-stealth';

/** Floating popover panel (menus, pickers) — Vyotiq UI elev. */
export const appPopoverPanelClassName = 'vx-popover-panel';

/** Inset note with optional body tone override (review/diff empties). */
export function chromeEmptyNoteClassName(tone: 'default' | 'muted' = 'default'): string {
  return cn(chromeInsetNoteClassName, tone === 'muted' && 'text-text-muted');
}

/** Ghost text button in settings rows (Reset, secondary actions). */
export const chromeGhostRowButtonClassName = 'vx-btn vx-btn-quiet inline-flex shrink-0 items-center gap-1.5';

/** Square icon-only ghost action (row toolbars, trace actions). */
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

/** Floating toolbar on code/diff (navigator, copy cluster). */
export const chromeFloatingToolbarClassName = cn(
  'rounded-inner border border-border-subtle/40 bg-surface-raised/80 px-0.5 py-0.5 backdrop-blur-sm'
);

/** Hover-revealed square icon (copy on code blocks). */
export function chromeRevealIconActionClassName(className?: string): string {
  return cn(
    chromeIconActionClassName,
    'opacity-0 transition-opacity duration-150 focus:opacity-100',
    className
  );
}

export type ChromeStatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

/** Semantic status pill (file kind, envelope status). */
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
