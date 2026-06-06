/**
 * Compact run token usage — prompt / completion split; hover shows
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
    `Prompt: ${formatTokenCountWithUnit(latest.promptTokens)}`,
    `Completion: ${formatTokenCountWithUnit(latest.completionTokens)}`,
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
        'vx-composer-token-pill shrink-0 font-mono text-meta text-text-secondary tabular-nums'
      )}
      title={title}
    >
      <BarChart2
        className={cn(SHELL_ROW_ICON_CLASS, 'inline-block shrink-0 align-[-2px]')}
        strokeWidth={SHELL_ROW_ICON_STROKE}
        aria-hidden
      />
      <span className="ml-1">
        {hasUsage ? (
          <>
            {formatTokenCount(latest.promptTokens)}
            <span className="mx-0.5 text-text-faint" aria-hidden>
              /
            </span>
            {formatTokenCount(latest.completionTokens)}
          </>
        ) : (
          <span className={cn(!draftEstimate?.exact && 'italic text-text-faint')}>
            ~{formatTokenCount(draftEstimate!.tokens)}
          </span>
        )}
      </span>
    </span>
  );
});
