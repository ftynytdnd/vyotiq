/**
 * Free-form "agent thought" line (e.g. nudge telemetry). Flush log-line
 * rhythm — live info rows use gold phase headings; warn rows stay stable.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { timelineLogRowClassName, timelinePhaseHeadingClassName } from '../shared/rowStyles.js';

interface AgentThoughtRowProps {
  content: string;
  severity?: 'info' | 'warn';
  live?: boolean;
}

export function AgentThoughtRow({
  content,
  severity = 'info',
  live = false
}: AgentThoughtRowProps) {
  if (severity === 'warn') {
    return (
      <div className={cn('vyotiq-stepfade-once px-2 py-0.5', timelineLogRowClassName)} data-row-kind="agent-thought">
        <div className="flex items-start gap-1.5 text-row">
          <AlertTriangle
            className="mt-[3px] h-3 w-3 shrink-0 text-warning-strong"
            strokeWidth={2.25}
          />
          <span className="text-warning-strong">{content}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('vyotiq-stepfade-once px-2 py-0.5', timelineLogRowClassName)} data-row-kind="agent-thought">
      <span
        className={
          live
            ? cn(timelinePhaseHeadingClassName(true), 'text-meta italic')
            : cn('text-meta italic text-text-faint')
        }
      >
        {content}
      </span>
    </div>
  );
}
