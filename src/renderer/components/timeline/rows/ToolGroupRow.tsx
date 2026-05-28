/**
 * ToolGroupRow — Cascade-style rolled-up line for each `tool-group` row.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import type { ToolName } from '@shared/types/tool.js';
import {
  toolGroupDiffStats,
  toolGroupStatus,
  toolGroupSummary,
  tailInFlightEditChildIndex,
  type ToolGroupChild
} from '../reducer/deriveRows.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { ToolInvocation } from '../tools/ToolInvocation.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { toolGroupLiveAutoExpand } from '../shared/toolInflight.js';
import { toolTitleClassName } from '../shared/rowStyles.js';

interface ToolGroupRowProps {
  rowKey: string;
  toolName: ToolName;
  items: ToolGroupChild[];
}

const LARGE_GROUP_THRESHOLD = 10;
const MAX_EXPANDED_CHILDREN = 5;

export function ToolGroupRow({ rowKey, toolName, items }: ToolGroupRowProps) {
  const status = toolGroupStatus(items);
  const liveAutoExpand = toolGroupLiveAutoExpand(toolName, items);
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey, liveAutoExpand });
  const [showAllChildren, setShowAllChildren] = useState(false);

  useEffect(() => {
    setShowAllChildren(false);
  }, [rowKey, items.length]);

  const { verb, primary, suffix } = useMemo(
    () => toolGroupSummary(toolName, items),
    [toolName, items]
  );

  const { additions: rawAdditions, deletions: rawDeletions } = useMemo(
    () => toolGroupDiffStats(items),
    [items]
  );

  const peakRef = useRef<{ additions: number; deletions: number }>({
    additions: 0,
    deletions: 0
  });
  let additions = rawAdditions;
  let deletions = rawDeletions;
  if (status === 'running') {
    additions = Math.max(rawAdditions, peakRef.current.additions);
    deletions = Math.max(rawDeletions, peakRef.current.deletions);
    peakRef.current = { additions, deletions };
  } else if (peakRef.current.additions > 0 || peakRef.current.deletions > 0) {
    peakRef.current = { additions: 0, deletions: 0 };
  }
  useEffect(() => {
    peakRef.current = { additions: 0, deletions: 0 };
  }, [rowKey]);
  const hasDiffStats = toolName === 'edit' && (additions > 0 || deletions > 0);
  const pendingStats = hasDiffStats && status === 'running';

  const tailLiveEditIdx = useMemo(
    () => (toolName === 'edit' ? tailInFlightEditChildIndex(items) : null),
    [toolName, items]
  );

  const running = status === 'running';
  const largeGroup = items.length >= LARGE_GROUP_THRESHOLD;
  const hiddenChildCount =
    expanded && largeGroup && !showAllChildren
      ? Math.max(0, items.length - MAX_EXPANDED_CHILDREN)
      : 0;
  const visibleItems =
    hiddenChildCount > 0 ? items.slice(0, MAX_EXPANDED_CHILDREN) : items;

  const label = (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 truncate text-row">
      <span className={toolTitleClassName(running)}>{verb}</span>
      {primary && (
        <>
          {' '}
          <span
            className={cn(
              'font-mono',
              running ? 'text-text-secondary' : 'text-text-muted'
            )}
          >
            {truncate(primary, 80)}
          </span>
        </>
      )}
      {suffix && <span className="text-text-muted">{suffix}</span>}
    </span>
  );

  return (
    <div className="vyotiq-stepfade-once flex flex-col" data-row-kind="tool-group">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable
        rowAnchorKey={rowKey}
        trailing={
          hasDiffStats ? (
            <DiffStatsBadge
              additions={additions}
              deletions={deletions}
              pending={pendingStats}
              className="shrink-0"
            />
          ) : undefined
        }
      >
        {label}
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat" gap="gap-1">
          {visibleItems.map((c, index) => (
            <ToolInvocation
              key={c.callId}
              {...(c.call ? { call: c.call } : {})}
              {...(c.result ? { result: c.result } : {})}
              dense
              rowKey={`inv:${c.callId}`}
              {...(c.partial ? { partial: true } : {})}
              {...(c.diffStream ? { diffStream: c.diffStream } : {})}
              {...(c.retryCount && c.retryCount > 1 ? { retryCount: c.retryCount } : {})}
              {...(tailLiveEditIdx !== null
                ? { liveAutoExpand: index === tailLiveEditIdx }
                : {})}
            />
          ))}
          {hiddenChildCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChildren(true)}
              className="self-start rounded-inner px-2 py-0.5 text-meta italic text-text-faint hover:bg-surface-hover hover:text-text-secondary"
            >
              Show all {items.length} calls
            </button>
          )}
        </DetailShell>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
