/**
 * ToolGroupRow — Cascade-style rolled-up line for each `tool-group` row.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import type { ToolName } from '@shared/types/tool.js';
import {
  toolGroupDiffStats,
  toolGroupStatus,
  toolGroupSummary,
  type ToolGroupChild
} from '../reducer/deriveRows.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { ToolInvocation } from '../tools/ToolInvocation.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { toolGroupLiveAutoExpand } from '../shared/toolInflight.js';
import {
  scrubPreviewSlice,
  toolGroupStreamingBody
} from '../shared/toolGroupScrubPreview.js';
import { useToolStatusAnnouncer } from '../shared/useToolStatusAnnouncer.js';
import { toolTitleClassName } from '../shared/rowStyles.js';
import { formatToolGroupDisplayPrimary } from '../shared/formatToolGroupDisplayPrimary.js';
import { CodeBlock } from '../tools/shared/CodeBlock.js';

interface ToolGroupRowProps {
  rowKey: string;
  toolName: ToolName;
  items: ToolGroupChild[];
}

const LARGE_GROUP_THRESHOLD = 10;
const MAX_EXPANDED_CHILDREN = 5;

export const ToolGroupRow = memo(function ToolGroupRow({ rowKey, toolName, items }: ToolGroupRowProps) {
  const status = toolGroupStatus(items);
  const liveAutoExpand = toolGroupLiveAutoExpand(toolName, items);
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey, liveAutoExpand });
  const [showAllChildren, setShowAllChildren] = useState(false);
  const [scrubHover, setScrubHover] = useState(false);
  const [scrubRatio, setScrubRatio] = useState(0);
  const panelId = `tool-group-panel-${rowKey}`;

  useEffect(() => {
    setShowAllChildren(false);
  }, [rowKey, items.length]);

  const { verb, primary, suffix } = useMemo(
    () => toolGroupSummary(toolName, items),
    [toolName, items]
  );

  const { display: primaryDisplay, title: primaryTitle } = useMemo(
    () => formatToolGroupDisplayPrimary(toolName, primary),
    [toolName, primary]
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

  const running = status === 'running';
  const failed = status === 'failed';
  const streamBody = useMemo(
    () => (running ? toolGroupStreamingBody(toolName, items) : ''),
    [running, toolName, items]
  );
  const scrubPreview = useMemo(
    () => scrubPreviewSlice(streamBody, scrubRatio),
    [streamBody, scrubRatio]
  );
  const showScrub = running && !expanded && scrubHover && streamBody.length > 0;
  const largeGroup = items.length >= LARGE_GROUP_THRESHOLD;
  const hiddenChildCount =
    expanded && largeGroup && !showAllChildren
      ? Math.max(0, items.length - MAX_EXPANDED_CHILDREN)
      : 0;
  const visibleItems =
    hiddenChildCount > 0 ? items.slice(0, MAX_EXPANDED_CHILDREN) : items;

  const summaryLabel = `${verb}${primary ? ` ${primary}` : ''}${suffix ?? ''}`;
  useToolStatusAnnouncer(summaryLabel, status);

  const showCount = items.length > 1 && !hasDiffStats;

  const label = (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 truncate text-row">
      <span className={toolTitleClassName(running, failed)}>{verb}</span>
      {primaryDisplay && (
        <>
          {' '}
          <span
            className={cn(
              'font-mono',
              running
                ? 'text-text-secondary'
                : failed
                  ? 'text-danger/80'
                  : 'text-text-muted'
            )}
            {...(primaryTitle ? { title: primaryTitle } : {})}
          >
            {primaryDisplay}
          </span>
        </>
      )}
      {suffix && <span className="text-text-muted">{suffix}</span>}
    </span>
  );

  return (
    <div
      className="vx-timeline-activity-row vyotiq-stepfade-once relative flex flex-col"
      data-row-kind="tool-group"
      data-status={status}
    >
      <div
        onMouseEnter={() => setScrubHover(true)}
        onMouseLeave={() => {
          setScrubHover(false);
          setScrubRatio(0);
        }}
        onMouseMove={(e) => {
          if (!running || expanded || !streamBody) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const w = rect.width || 1;
          setScrubRatio(Math.min(1, Math.max(0, (e.clientX - rect.left) / w)));
        }}
      >
        <TimelineRowHeader
          expanded={expanded}
          onToggle={onToggle}
          expandable
          chevronOnRight
          expandAriaLabel={expanded ? 'Collapse tool group' : 'Expand tool group'}
          rowAnchorKey={rowKey}
          panelId={panelId}
          trailing={
            <>
              {showCount ? (
                <span
                  className="vx-tool-group-count shrink-0 font-mono tabular-nums"
                  aria-label={`${items.length} tool calls`}
                >
                  ×{items.length}
                </span>
              ) : null}
              {hasDiffStats ? (
                <DiffStatsBadge
                  additions={additions}
                  deletions={deletions}
                  pending={pendingStats}
                  className="shrink-0"
                />
              ) : null}
            </>
          }
        >
          {label}
        </TimelineRowHeader>
      </div>

      {showScrub && (
        <div
          className="vx-tool-scrub-preview pointer-events-none absolute left-0 right-0 top-full z-20 mt-0.5 max-h-28 overflow-hidden rounded-inner border border-border-subtle/40 bg-surface-sidebar/95 px-2 py-1 shadow-md"
          aria-hidden
        >
          <CodeBlock body={scrubPreview} tone="muted" maxHeight={104} />
        </div>
      )}

      {expanded && (
        <DetailShell variant="flat" gap="gap-1">
          <div id={panelId} className="contents">
          {visibleItems.map((c) => (
            <ToolInvocation
              key={c.callId}
              {...(c.call ? { call: c.call } : {})}
              {...(c.result ? { result: c.result } : {})}
              dense
              rowKey={`inv:${c.callId}`}
              groupExpanded={expanded}
              {...(c.partial ? { partial: true } : {})}
              {...(c.diffStream ? { diffStream: c.diffStream } : {})}
              {...(c.retryCount && c.retryCount > 1 ? { retryCount: c.retryCount } : {})}
            />
          ))}
          {hiddenChildCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChildren(true)}
              className="self-start vx-btn-text px-2 py-0.5 text-meta italic"
            >
              Show all {items.length} calls
            </button>
          )}
          </div>
        </DetailShell>
      )}
    </div>
  );
});
