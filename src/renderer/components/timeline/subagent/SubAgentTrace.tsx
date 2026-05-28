/**
 * Inline sub-agent trace — collapsed header, manual expand only.
 */

import { useChatStore } from '../../../store/useChatStore.js';
import { AgentTraceContent } from '../../agent/AgentTraceContent.js';
import { resolveSubAgentSubtitle } from '../../agent/trace/subtitleResolver.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { timelineSubAgentDotClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { sanitizeTraceTitle } from '../../../lib/traceSanitize.js';

interface SubAgentTraceProps {
  subagentId: string;
}

export function SubAgentTrace({ subagentId }: SubAgentTraceProps) {
  const snap = useChatStore((s) => s.subagents[subagentId]);
  const rowKey = `subagent:${subagentId}`;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: false
  });

  if (!snap) return null;

  const running = snap.status === 'pending' || snap.status === 'running';
  const taskLabel = sanitizeTraceTitle(snap.task) || subagentId.slice(0, 8);
  const subtitle = resolveSubAgentSubtitle(snap);

  const header = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-row text-text-muted">
      <span className={timelineSubAgentDotClassName(running)} aria-hidden />
      <span className="min-w-0 truncate">
        <span className="vx-row-label text-text-secondary">{taskLabel}</span>
        {subtitle ? (
          <span className="vx-row-desc text-text-muted"> · {subtitle}</span>
        ) : null}
      </span>
    </span>
  );

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once flex flex-col',
        'rounded-inner transition-colors hover:bg-surface-raised/30'
      )}
      data-row-kind="subagent-line"
      data-subagent-id={subagentId}
    >
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        chevronOnRight
        expandAriaLabel={expanded ? 'Collapse sub-agent trace' : 'Expand sub-agent trace'}
        panelId={`timeline-panel-${rowKey}`}
        rowAnchorKey={rowKey}
        className="px-2 py-0.5"
      >
        {header}
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flush">
          <div
            id={`timeline-panel-${rowKey}`}
            className="scrollbar-stealth max-h-[min(60dvh,480px)] overflow-y-auto"
          >
            <AgentTraceContent snap={snap} />
          </div>
        </DetailShell>
      )}
    </div>
  );
}
