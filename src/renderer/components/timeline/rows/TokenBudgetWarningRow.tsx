/**
 * Quiet warning when orchestrator token usage crosses the configured threshold.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../../lib/shellIcons.js';
import { timelineLogRowClassName } from '../shared/rowStyles.js';

interface TokenBudgetWarningRowProps {
  percent: number;
  tokens?: number;
  ceiling?: number;
}

export function TokenBudgetWarningRow({ percent, tokens, ceiling }: TokenBudgetWarningRowProps) {
  const detail =
    typeof tokens === 'number' && typeof ceiling === 'number'
      ? `${tokens.toLocaleString()} / ${ceiling.toLocaleString()} tokens`
      : null;

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once flex items-center justify-start gap-1.5 text-warning vx-timeline-meta',
        timelineLogRowClassName
      )}
      data-row-kind="token-budget-warning"
      role="status"
      aria-label={`Context window ${percent}% full${detail ? `, ${detail}` : ''}`}
    >
      <AlertTriangle className={cn(SHELL_ROW_ICON_CLASS, 'opacity-80')} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
      <span>
        Context {percent}% full
        {detail && (
          <span className="ml-1 font-mono vx-timeline-meta">({detail})</span>
        )}
      </span>
    </div>
  );
}
