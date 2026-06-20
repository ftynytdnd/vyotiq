/**
 * Free-form "agent thought" line (e.g. nudge telemetry). Flush log-line
 * rhythm — live info rows use gold phase headings; warn rows stay stable.
 */

import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import { timelineLogRowClassName, timelinePhaseHeadingClassName } from '../shared/rowStyles.js';

interface AgentThoughtRowProps {
  content: string;
  severity?: 'info' | 'warn';
  variant?: 'caption' | 'notice';
  live?: boolean;
}

const COLLAPSED_LEN = 160;

export function AgentThoughtRow({
  content,
  severity = 'info',
  variant = 'caption',
  live = false
}: AgentThoughtRowProps) {
  const [expanded, setExpanded] = useState(false);
  const long = content.length > COLLAPSED_LEN;
  const shown = long && !expanded ? `${content.slice(0, COLLAPSED_LEN - 1)}…` : content;

  if (severity === 'warn') {
    return (
      <div className={cn('vyotiq-stepfade-once px-2 py-0.5', timelineLogRowClassName)} data-row-kind="agent-thought">
        <div className="flex items-start gap-1.5 text-row">
          <AlertTriangle
            className={cn(SHELL_ROW_ICON_CLASS, 'text-warning-strong')}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
          <span className="min-w-0 flex-1 text-warning-strong">{shown}</span>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="vx-btn vx-btn-quiet shrink-0 px-0.5 py-0 text-meta text-text-faint"
              aria-expanded={expanded}
            >
              {expanded ? 'Less' : 'More'}
              <ChevronDown
                className={cn(SHELL_MICRO_ICON_CLASS, expanded && 'rotate-180')}
                strokeWidth={SHELL_MICRO_ICON_STROKE}
              />
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('vyotiq-stepfade-once px-2 py-0.5', timelineLogRowClassName)} data-row-kind="agent-thought">
      <div className="flex items-start gap-1">
        <span
          className={cn(
            'min-w-0 flex-1',
            live
              ? cn(timelinePhaseHeadingClassName(true), 'text-meta italic')
              : variant === 'notice'
                ? 'vx-timeline-meta text-text-secondary'
                : cn('text-meta italic vx-caption')
          )}
        >
          {shown}
        </span>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="vx-btn vx-btn-quiet shrink-0 px-0.5 py-0 text-meta text-text-faint"
            aria-expanded={expanded}
          >
            {expanded ? 'Less' : 'More'}
            <ChevronDown
              className={cn(SHELL_MICRO_ICON_CLASS, expanded && 'rotate-180')}
              strokeWidth={SHELL_MICRO_ICON_STROKE}
            />
          </button>
        )}
      </div>
    </div>
  );
}
