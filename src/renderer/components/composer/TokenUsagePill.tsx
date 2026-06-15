/**
 * Compact run token usage — separate in/out micro-pills; hover shows
 * orchestrator breakdown and estimated cost.
 */

import { memo, useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { TokenUsage } from '@shared/types/chat.js';
import type { TokenUsageAggregate } from '../timeline/reducer/types.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { formatTokenCount, formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { formatLiveTokenRate, resolveLiveCompletionTokens } from '../../lib/liveTokenRate.js';
import { useLiveTokenRate } from '../../lib/useLiveTokenRate.js';
import { resolveLiveTurnCost } from '../../lib/workspaceSpend.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { formatComposerCostUsd } from '@shared/providers/estimateRunCost.js';

interface TokenUsagePillProps {
  model?: ModelSelection | null;
  total?: TokenUsageAggregate;
  orchestrator?: TokenUsageAggregate;
  /** Pre-flight draft estimate for the current composer input. */
  draftEstimate?: { tokens: number; exact: boolean } | null;
}

function usageLine(label: string, u: TokenUsage | undefined): string[] {
  if (!u || (u.promptTokens <= 0 && u.completionTokens <= 0)) return [];
  const lines: string[] = [`${label}:`];
  if (u.promptTokens > 0) lines.push(`  Prompt: ${formatTokenCountWithUnit(u.promptTokens)}`);
  if (u.completionTokens > 0) {
    lines.push(`  Completion: ${formatTokenCountWithUnit(u.completionTokens)}`);
  }
  if ((u.cachedPromptTokens ?? 0) > 0) {
    lines.push(`  Cache read: ${formatTokenCountWithUnit(u.cachedPromptTokens ?? 0)}`);
  }
  if ((u.cacheCreationTokens ?? 0) > 0) {
    lines.push(`  Cache write: ${formatTokenCountWithUnit(u.cacheCreationTokens ?? 0)}`);
  }
  if ((u.uncachedPromptTokens ?? 0) > 0) {
    lines.push(`  Uncached: ${formatTokenCountWithUnit(u.uncachedPromptTokens ?? 0)}`);
  }
  return lines;
}

function buildTitle(
  latest: TokenUsage,
  orchestrator: TokenUsageAggregate | undefined,
  costLabel: string | null,
  costBreakdown: ReturnType<typeof resolveLiveTurnCost>,
  liveTokenRateLabel: string | null
): string {
  const lines: string[] = [
    `Last turn — in: ${formatTokenCountWithUnit(latest.promptTokens)}`,
    `Last turn — out: ${formatTokenCountWithUnit(
      resolveLiveCompletionTokens(orchestrator ?? { latest })
    )}`
  ];
  if (liveTokenRateLabel) {
    lines.push(`Live output: ${liveTokenRateLabel}`);
  }
  if (costLabel) {
    lines.push(`Estimated cost: ${costLabel}`);
    if (costBreakdown) {
      const b = costBreakdown.breakdown;
      lines.push(
        `  Input: ${formatComposerCostUsd(b.inputUsd)}`,
        `  Output: ${formatComposerCostUsd(b.outputUsd)}`
      );
      if (b.cachedInputUsd > 0) {
        lines.push(`  Cache read: ${formatComposerCostUsd(b.cachedInputUsd)}`);
      }
      if (b.cacheWriteUsd > 0) {
        lines.push(`  Cache write: ${formatComposerCostUsd(b.cacheWriteUsd)}`);
      }
      if (b.reasoningUsd > 0) {
        lines.push(`  Reasoning: ${formatComposerCostUsd(b.reasoningUsd)}`);
      }
      if (b.grossCacheSavingsUsd > 0) {
        lines.push(`  Cache saved (gross): ${formatComposerCostUsd(b.grossCacheSavingsUsd)}`);
      }
      if (b.netCacheSavingsUsd > 0 && b.netCacheSavingsUsd !== b.grossCacheSavingsUsd) {
        lines.push(`  Cache saved (net): ${formatComposerCostUsd(b.netCacheSavingsUsd)}`);
      }
      if (costBreakdown?.partial) {
        lines.push('  (Partial — prompt/cache pending authoritative usage)');
      }
    }
  }
  lines.push('', 'Conversation session — last turn frame', '', 'By role:');
  lines.push(...usageLine('Orchestrator', orchestrator?.latest));
  return lines.join('\n');
}

export const TokenUsagePill = memo(function TokenUsagePill({
  model = null,
  total,
  orchestrator,
  draftEstimate = null
}: TokenUsagePillProps) {
  const providers = useProviderStore((s) => s.providers);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const hasInFlight = orchestrator?.inFlight !== undefined;
  const completionTokens = resolveLiveCompletionTokens(orchestrator ?? total);
  const liveTokenRate = useLiveTokenRate(
    isProcessing || hasInFlight,
    completionTokens
  );
  const liveTokenRateLabel =
    liveTokenRate !== null && liveTokenRate > 0 ? formatLiveTokenRate(liveTokenRate) : null;
  const { latest } = total ?? {
    latest: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  };
  const outCount =
    orchestrator?.inFlight !== undefined
      ? completionTokens
      : latest.completionTokens;
  const liveCost = useMemo(
    () => resolveLiveTurnCost(model, providers, orchestrator),
    [model, providers, orchestrator]
  );
  const hasUsage =
    latest.promptTokens > 0 ||
    latest.completionTokens > 0 ||
    (orchestrator?.inFlight?.completionTokens ?? 0) > 0;
  const hasDraft = draftEstimate != null && draftEstimate.tokens > 0;

  if (!hasUsage && !hasDraft) return null;

  const title = hasUsage
    ? buildTitle(latest, orchestrator, liveCost?.label ?? null, liveCost, liveTokenRateLabel)
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
          aria-label={`Last turn input ${formatTokenCount(latest.promptTokens)} tokens, output ${formatTokenCount(outCount)} tokens${liveTokenRateLabel ? `, ${liveTokenRateLabel}` : ''}${liveCost ? `, estimated ${liveCost.label}` : ''}`}
        >
          <span className="vx-composer-turn-usage__pill">
            <span className="vx-composer-turn-usage__dir">in</span>
            {formatTokenCount(latest.promptTokens)}
          </span>
          <span className="vx-composer-turn-usage__pill">
            <span className="vx-composer-turn-usage__dir">out</span>
            {formatTokenCount(outCount)}
            {liveTokenRateLabel ? (
              <span className="vx-composer-turn-usage__rate" title="Live output throughput">
                {' · '}
                {liveTokenRateLabel}
              </span>
            ) : null}
          </span>
          {liveCost ? (
            <span className="vx-composer-turn-usage__pill vx-composer-turn-usage__pill--cost">
              {liveCost.label}
            </span>
          ) : null}
        </span>
      ) : (
        <span className={cn('ml-1', !draftEstimate?.exact && 'italic text-text-faint')}>
          ~{formatTokenCount(draftEstimate!.tokens)}
        </span>
      )}
    </span>
  );
});
