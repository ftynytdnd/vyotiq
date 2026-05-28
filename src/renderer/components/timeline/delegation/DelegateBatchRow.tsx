/**
 * V5 delegate batch — one tool-like row for parallel sub-agent spawns.
 * Expanded: inline roster with per-worker SubAgentTrace (Run/Brief/Result tabs).
 */

import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { SubAgentTrace } from '../subagent/SubAgentTrace.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { delegateBatchHasInflightDiff } from '../shared/toolInflight.js';
import { timelineSubAgentDotClassName } from '../shared/rowStyles.js';
interface DelegateBatchRowProps {
  rowKey: string;
  subagentIds: string[];
}

export function DelegateBatchRow({ rowKey, subagentIds }: DelegateBatchRowProps) {
  const subagents = useChatStore((s) => s.subagents);

  const stats = useMemo(() => {
    let running = 0;
    let done = 0;
    let failed = 0;
    for (const id of subagentIds) {
      const s = subagents[id];
      if (!s) continue;
      if (s.status === 'pending' || s.status === 'running') running++;
      else if (s.status === 'done' || s.status === 'partial') done++;
      else failed++;
    }
    return { running, done, failed };
  }, [subagentIds, subagents]);

  const isLive = stats.running > 0;
  const hasInflightDiff = useMemo(
    () => delegateBatchHasInflightDiff(subagentIds, subagents),
    [subagentIds, subagents]
  );
  const liveAutoExpand = isLive || hasInflightDiff;
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey, liveAutoExpand });

  const metaParts: string[] = [];
  if (stats.running > 0) metaParts.push(`${stats.running} running`);
  if (stats.done > 0) metaParts.push(`${stats.done} done`);
  if (stats.failed > 0) metaParts.push(`${stats.failed} failed`);

  const taskLabel =
    subagentIds.length === 1 ? '1 task' : `${subagentIds.length} tasks`;

  return (
    <div data-row-kind="delegate-batch" className="vyotiq-stepfade-once flex flex-col">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable
        chevronOnRight
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-row">
          <span className={timelineSubAgentDotClassName(isLive)} aria-hidden />
          <span className="min-w-0 truncate">
            <span className="font-medium text-text-primary">Delegated</span>{' '}
            <span className="text-text-secondary">{taskLabel}</span>
            {metaParts.length > 0 && (
              <span className="text-text-muted"> · {metaParts.join(' · ')}</span>
            )}
          </span>
        </span>
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat" gap="gap-0.5">
          {subagentIds.map((id) => (
            <SubAgentTrace key={id} subagentId={id} nested />
          ))}
        </DetailShell>
      )}
    </div>
  );
}
