/**
 * FileEditGroupRow — Cascade-style rolled-up line for a run of file-edit
 * events.
 *
 * Collapsed:
 *   [chevron] [icon]  Edited foo.tsx and 3 other files   [+N -M]
 *
 * Expanded: the existing `FileEditRow` cards (elevated, with `Open ↗`)
 * listed one per file so the user can still drill into each diff.
 *
 * Expansion state is persisted per-conversation via `useTimelineUiStore`.
 */

import { useMemo } from 'react';
import { FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import type { FileEditGroupChild } from '../reducer/deriveRows.js';
import { FileEditRow } from './FileEditRow.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { DetailShell } from '../shared/DetailShell.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { cn } from '../../../lib/cn.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName,
  timelineRowIconClassName
} from '../shared/rowStyles.js';

interface FileEditGroupRowProps {
  rowKey: string;
  items: FileEditGroupChild[];
}

export function FileEditGroupRow({ rowKey, items }: FileEditGroupRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const expanded = useTimelineUiStore((s) => s.isExpanded(conversationId, rowKey));
  const toggle = useTimelineUiStore((s) => s.toggle);

  const { primary, rest, additions, deletions } = useMemo(() => {
    let a = 0;
    let d = 0;
    for (const c of items) {
      a += c.additions;
      d += c.deletions;
    }
    return {
      primary: items[0]?.filePath ?? '',
      rest: Math.max(0, items.length - 1),
      additions: a,
      deletions: d
    };
  }, [items]);

  const suffix = rest > 0 ? ` and ${rest} other file${rest === 1 ? '' : 's'}` : '';

  const onToggle = () => {
    if (!conversationId) return;
    toggle(conversationId, rowKey);
  };

  return (
    <SurfaceShell className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={!conversationId}
        aria-expanded={expanded}
        className={cn(
          timelineRowHeaderClassName,
          conversationId ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {expanded ? (
          <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
        ) : (
          <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
        )}
        <FileCode className={cn(timelineRowIconClassName, 'text-accent')} strokeWidth={2} />
        <div className="min-w-0 flex-1 truncate text-row text-text-secondary">
          <span className="font-medium text-text-primary">Edited</span>{' '}
          <span className="font-mono">{primary}</span>
          {suffix && <span className="text-text-muted">{suffix}</span>}
        </div>
        <DiffStatsBadge additions={additions} deletions={deletions} className="shrink-0" />
      </button>

      {expanded && (
        <DetailShell gap="gap-1">
          {items.map((c) => (
            <FileEditRow
              key={c.key}
              filePath={c.filePath}
              additions={c.additions}
              deletions={c.deletions}
            />
          ))}
        </DetailShell>
      )}
    </SurfaceShell>
  );
}
