/**
 * Delegate batch — one quiet line when sub-agents start (detail in AgentTracePanel).
 */

import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../../store/useSecondaryZoneStore.js';
import { timelineSubAgentDotClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

interface DelegateBatchRowProps {
  rowKey: string;
  subagentIds: string[];
}

export function DelegateBatchRow({ subagentIds }: DelegateBatchRowProps) {
  const subagents = useChatStore((s) => s.subagents);
  const openAgentTrace = useSecondaryZoneStore((s) => s.openAgentTrace);

  const stats = useMemo(() => {
    const delegated = subagentIds.length;
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
    running = Math.min(running, delegated);
    failed = Math.min(failed, delegated);
    done = Math.min(done, Math.max(0, delegated - running - failed));
    return { running, done, failed, delegated };
  }, [subagentIds, subagents]);

  const isLive = stats.running > 0;

  const metaParts: string[] = [];
  if (stats.running > 0) metaParts.push(`${stats.running} running`);
  if (stats.done > 0) metaParts.push(`${stats.done} done`);
  if (stats.failed > 0) metaParts.push(`${stats.failed} failed`);

  const taskLabel =
    subagentIds.length === 1 ? '1 task' : `${subagentIds.length} tasks`;

  const onOpenTrace = () => {
    const preferred =
      subagentIds.find((id) => {
        const s = subagents[id];
        return s?.status === 'running' || s?.status === 'pending';
      }) ?? subagentIds[0];
    if (preferred) openAgentTrace(preferred);
  };

  return (
    <button
      type="button"
      data-row-kind="delegate-batch"
      onClick={onOpenTrace}
      className={cn(
        'vyotiq-stepfade-once w-full px-2 py-1 text-left',
        'rounded-inner transition-colors hover:bg-surface-raised/40'
      )}
      aria-label={`Open sub-agent trace for ${taskLabel}`}
    >
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-row text-text-muted">
        <span className={timelineSubAgentDotClassName(isLive)} aria-hidden />
        <span className="min-w-0 truncate">
          <span className="vx-row-label">Delegated</span>{' '}
          <span className="vx-row-desc">{taskLabel}</span>
          {metaParts.length > 0 && (
            <span className="vx-caption"> · {metaParts.join(' · ')}</span>
          )}
        </span>
      </span>
    </button>
  );
}
