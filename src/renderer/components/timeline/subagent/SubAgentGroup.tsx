/**
 * Sub-agent group — optional meta line + N inline SubAgentTrace rows.
 */

import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { SubAgentTrace } from './SubAgentTrace.js';
import { timelineSubAgentDotClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

interface SubAgentGroupProps {
  subagentIds: string[];
}

export function SubAgentGroup({ subagentIds }: SubAgentGroupProps) {
  const subagents = useChatStore((s) => s.subagents);

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

  const showMeta = subagentIds.length > 1;
  const isLive = stats.running > 0;

  const metaParts: string[] = [];
  if (stats.running > 0) metaParts.push(`${stats.running} running`);
  if (stats.done > 0) metaParts.push(`${stats.done} done`);
  if (stats.failed > 0) metaParts.push(`${stats.failed} failed`);

  const taskLabel =
    subagentIds.length === 1 ? '1 task' : `${subagentIds.length} tasks`;

  return (
    <div
      className={cn('vyotiq-stepfade-once flex flex-col gap-0.5')}
      data-row-kind="subagent-group"
    >
      {showMeta && (
        <div
          className="px-2 py-0.5 text-row text-text-muted"
          aria-label={`Delegated ${taskLabel}`}
        >
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate">
            <span className={timelineSubAgentDotClassName(isLive)} aria-hidden />
            <span className="min-w-0 truncate">
              <span className="vx-row-label">Delegated</span>{' '}
              <span className="vx-row-desc">{taskLabel}</span>
              {metaParts.length > 0 && (
                <span className="vx-caption"> · {metaParts.join(' · ')}</span>
              )}
            </span>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {subagentIds.map((id) => (
          <SubAgentTrace key={id} subagentId={id} />
        ))}
      </div>
    </div>
  );
}
