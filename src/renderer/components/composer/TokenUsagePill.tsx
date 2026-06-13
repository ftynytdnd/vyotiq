/**
 * Compact run token usage — separate in/out micro-pills; hover shows
 * orchestrator breakdown.
 */

import { memo } from 'react';
import { BarChart2 } from 'lucide-react';
import type { TokenUsageAggregate } from '../timeline/reducer/types.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { formatTokenCount, formatTokenCountWithUnit } from '../../lib/formatTokens.js';

interface TokenUsagePillProps {
  total?: TokenUsageAggregate;
  orchestrator?: TokenUsageAggregate;
  /** Pre-flight draft estimate for the current composer input. */
  draftEstimate?: { tokens: number; exact: boolean } | null;
}

function usageLine(label: string, u: import('@shared/types/chat.js').TokenUsage | undefined): string[] {
  if (!u || (u.promptTokens <= 0 && u.completionTokens <= 0)) return [];
  const lines: string[] = [`${label}:`];
  if (u.promptTokens > 0) lines.push(`  Prompt: ${formatTokenCountWithUnit(u.promptTokens)}`);
  if (u.completionTokens > 0) {
    lines.push(`  Completion: ${formatTokenCountWithUnit(u.completionTokens)}`);
  }
  return lines;
}

function buildTitle(
  latest: import('@shared/types/chat.js').TokenUsage,
  orchestrator: TokenUsageAggregate | undefined
): string {
  const lines: string[] = [
    `Last turn — in: ${formatTokenCountWithUnit(latest.promptTokens)}`,
    `Last turn — out: ${formatTokenCountWithUnit(latest.completionTokens)}`,
    '',
    'By role:'
  ];
  lines.push(...usageLine('Orchestrator', orchestrator?.latest));
  return lines.join('\n');
}

export const TokenUsagePill = memo(function TokenUsagePill({
  total,
  orchestrator,
  draftEstimate = null
}: TokenUsagePillProps) {
  const { latest } = total ?? {
    latest: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  };
  const hasUsage = latest.promptTokens > 0 || latest.completionTokens > 0;
  const hasDraft = draftEstimate != null && draftEstimate.tokens > 0;

  if (!hasUsage && !hasDraft) return null;

  const title = hasUsage
    ? buildTitle(latest, orchestrator)
    : hasDraft
      ? `Draft estimate: ~${formatTokenCountWithUnit(draftEstimate.tokens)}${draftEstimate.exact ? '' : ' (approx.)'}`
      : '';

  return (
    <span
      className={cn(
        'vx-composer-token-pill vx-composer-turn-usage shrink-0 font-mono text-meta text-text-secondary tabular-nums'
      )}
      title={title}
    >
      <BarChart2
        className={cn(SHELL_ROW_ICON_CLASS, 'inline-block shrink-0 align-[-2px]')}
        strokeWidth={SHELL_ROW_ICON_STROKE}
        aria-hidden
      />
      {hasUsage ? (
        <span
          className="vx-composer-turn-usage__cluster"
          aria-label={`Last turn input ${formatTokenCount(latest.promptTokens)} tokens, output ${formatTokenCount(latest.completionTokens)} tokens`}
        >
          <span className="vx-composer-turn-usage__pill">
            <span className="vx-composer-turn-usage__dir">in</span>
            {formatTokenCount(latest.promptTokens)}
          </span>
          <span className="vx-composer-turn-usage__pill">
            <span className="vx-composer-turn-usage__dir">out</span>
            {formatTokenCount(latest.completionTokens)}
          </span>
        </span>
      ) : (
        <span className={cn('ml-1', !draftEstimate?.exact && 'italic text-text-faint')}>
          ~{formatTokenCount(draftEstimate!.tokens)}
        </span>
      )}
    </span>
  );
});
