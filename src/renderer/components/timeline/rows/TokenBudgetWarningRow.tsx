/**
 * Quiet warning when orchestrator token usage crosses 70% of the model window.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
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
        'vyotiq-stepfade-once flex items-center justify-center gap-1.5 py-1 text-meta text-warning',
        timelineLogRowClassName
      )}
      data-row-kind="token-budget-warning"
      role="status"
      aria-label={`Context window ${percent}% full${detail ? `, ${detail}` : ''}`}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
      <span>
        Context {percent}% full
        {detail && (
          <span className="ml-1 font-mono text-text-faint">({detail})</span>
        )}
      </span>
    </div>
  );
}
