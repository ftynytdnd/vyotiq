/**
 * Shared class names for timeline row chrome aligned with composer/dock.
 */

import { cn } from '../../../lib/cn.js';

/** Compact clickable row header (tool groups, reasoning, sub-agent collapsed). */
export const timelineRowHeaderClassName = cn(
  'app-no-drag flex w-full items-center gap-2 rounded-inner px-2 py-1 text-left',
  'bg-surface-overlay/30 transition-colors duration-150',
  'hover:bg-surface-hover/60'
);

/** Dock-style action pill used in row toolbars. */
export const timelineActionPillClassName = cn(
  'inline-flex h-6 items-center gap-1 rounded-inner bg-surface-overlay px-1.5 text-row text-text-faint',
  'transition-colors duration-150',
  'hover:bg-surface-hover hover:text-text-primary'
);

/** Icon box for compact row headers. */
export const timelineRowIconClassName = 'h-3.5 w-3.5 shrink-0';

/** Chevron in row headers. */
export const timelineRowChevronClassName = cn(timelineRowIconClassName, 'text-chevron');
