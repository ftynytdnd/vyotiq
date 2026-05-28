/**
 * Shared grid row chrome for pending file rows.
 * Keeps path, diff stats, and actions column-aligned across the list.
 */

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { timelineRowChevronClassName, timelineRowChevronStroke } from '../../timeline/shared/rowStyles.js';
import {
  pendingExpandButtonClassName,
  pendingFileRowGridClassName,
  pendingFileRowNestedGridClassName,
  pendingListHeaderClassName
} from './pendingPanelStyles.js';

interface PendingFileRowShellProps {
  nested?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  showExpand?: boolean;
  path: ReactNode;
  stats: ReactNode;
  actions: ReactNode;
  className?: string;
}

export function PendingFileRowShell({
  nested = false,
  expanded = false,
  onToggleExpand,
  showExpand = true,
  path,
  stats,
  actions,
  className
}: PendingFileRowShellProps) {
  return (
    <div
      className={cn(
        nested ? pendingFileRowNestedGridClassName : pendingFileRowGridClassName,
        className
      )}
    >
      {showExpand && onToggleExpand ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className={pendingExpandButtonClassName}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse row' : 'Expand row'}
        >
          {expanded ? (
            <ChevronDown className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          ) : (
            <ChevronRight className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          )}
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">{path}</div>
      <div className="justify-self-end">{stats}</div>
      <div className="justify-self-end">{actions}</div>
    </div>
  );
}

export function PendingChangesListHeader() {
  return (
    <div className={pendingListHeaderClassName}>
      <span aria-hidden />
      <span>File</span>
      <span className="justify-self-end">Diff</span>
      <span className="justify-self-end pr-1">Actions</span>
    </div>
  );
}
