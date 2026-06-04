/**
 * Collapsible timeline row header — chevron, label slot, trailing stats,
 * and optional side actions.
 */

import type { MouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import {
  timelineRowChevronClassName,
  timelineRowChevronStroke,
  timelineRowHeaderClassName
} from './rowStyles.js';
import { copyRowAnchor } from './timelineRowAnchor.js';

export interface TimelineRowHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  expandable?: boolean;
  /** Reserve chevron space when the row is not expandable (dense tool rows). */
  chevronSpacer?: boolean;
  trailing?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Ctrl/Cmd+click on the chevron copies `#row-<key>` to the clipboard. */
  rowAnchorKey?: string;
  /** Stable id for the expandable panel controlled by this header. */
  panelId?: string;
  /** Screen-reader label for the expand control (visible title stays in `children`). */
  expandAriaLabel?: string;
  /**
   * Place the expand/collapse chevron on the trailing edge instead of
   * the leading edge. Used by the timeline row restyle so
   * the row reads `[● title] [trailing] [chevron]` with a dot-prefixed
   * header. Defaults to the legacy leading position for every other caller.
   */
  chevronOnRight?: boolean;
}

export function TimelineRowHeader({
  expanded,
  onToggle,
  expandable = true,
  chevronSpacer = false,
  trailing,
  actions,
  className,
  children,
  rowAnchorKey,
  panelId,
  chevronOnRight = false,
  expandAriaLabel
}: TimelineRowHeaderProps) {
  const showChevronSlot = expandable || chevronSpacer;

  const handleToggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (rowAnchorKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void copyRowAnchor(rowAnchorKey);
      return;
    }
    onToggle();
  };

  const chevronSlot = showChevronSlot ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
      {expandable ? (
        expanded ? (
          <ChevronDown className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
        ) : (
          <ChevronRight className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
        )
      ) : null}
    </span>
  ) : null;

  const headerInner = (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {!chevronOnRight && chevronSlot}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {trailing}
      {chevronOnRight && chevronSlot}
    </span>
  );

  return (
    <div className={cn('flex w-full min-w-0 items-center gap-1', className)}>
      {expandable ? (
        <button
          type="button"
          onClick={handleToggle}
          className={cn(timelineRowHeaderClassName, 'min-w-0 flex-1')}
          aria-expanded={expanded}
          {...(expandAriaLabel ? { 'aria-label': expandAriaLabel } : {})}
          {...(panelId ? { 'aria-controls': panelId } : {})}
          title={rowAnchorKey ? 'Ctrl+click to copy row link' : undefined}
        >
          {headerInner}
        </button>
      ) : (
        <div className={cn(timelineRowHeaderClassName, 'min-w-0 flex-1')}>
          {headerInner}
        </div>
      )}
      {actions}
    </div>
  );
}
