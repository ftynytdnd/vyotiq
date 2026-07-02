/**
 * Shared turn metadata labels for run-complete and error footers.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import { estimateCostForUsage, resolveModelForPrompt } from '../../../lib/workspaceSpend.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { formatDuration, formatWallClock } from './runCompleteFormat.js';
import {
  LONG_TURN_WARN_MS,
  VERY_LONG_TURN_WARN_MS
} from '@shared/timeline/longTurnThresholds.js';

export interface TurnMetaCounts {
  editCount?: number;
  fileCount?: number;
  commandCount?: number;
}

export interface TurnMetaConversationMeta {
  lastProviderId?: string;
  lastModelId?: string;
}

export interface TurnMetaLabels {
  stats: string[];
  tokenLabel: string | null;
  cacheLabel: string | null;
  costLabel: string | null;
  timeLabel: string;
  durationLabel: string;
  tokenTitle: string | null;
  ariaLabel: string;
  veryLongTurn: boolean;
  longTurn: boolean;
  durationTitle?: string;
}

export function formatTurnStats({
  editCount,
  fileCount,
  commandCount
}: TurnMetaCounts): string[] {
  const stats: string[] = [];
  if (typeof editCount === 'number' && editCount > 0) {
    stats.push(`${editCount} edit${editCount === 1 ? '' : 's'}`);
  }
  if (typeof fileCount === 'number' && fileCount > 0) {
    stats.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }
  if (typeof commandCount === 'number' && commandCount > 0) {
    stats.push(`${commandCount} command${commandCount === 1 ? '' : 's'}`);
  }
  return stats;
}

export function formatTurnCacheLabel(
  usage: TokenUsageAggregate | undefined,
  options?: { includeCacheWrite?: boolean }
): string | null {
  const cachedTokens = usage?.cumulative.cachedPromptTokens ?? 0;
  const uncachedTokens = usage?.cumulative.uncachedPromptTokens ?? 0;
  const cacheWriteTokens = usage?.cumulative.cacheCreationTokens ?? 0;
  const cacheParts: string[] = [];
  if (cachedTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(cachedTokens)} cached`);
  }
  if (uncachedTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(uncachedTokens)} uncached`);
  }
  if (options?.includeCacheWrite && cacheWriteTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(cacheWriteTokens)} cache write`);
  }
  return cacheParts.length > 0 ? cacheParts.join(' · ') : null;
}

export function resolveTurnModelForCost(
  events: TimelineEvent[],
  promptId: string | undefined,
  conversationMeta: TurnMetaConversationMeta | null
): ModelSelection | null {
  if (promptId === undefined) return null;
  return resolveModelForPrompt(
    events,
    promptId,
    conversationMeta?.lastProviderId && conversationMeta?.lastModelId
      ? {
          providerId: conversationMeta.lastProviderId,
          modelId: conversationMeta.lastModelId
        }
      : null
  );
}

export function buildTurnMetaLabels(input: {
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  modelForCost: ModelSelection | null;
  providers: ProviderConfig[];
  continued?: boolean;
  includeCacheWrite?: boolean;
} & TurnMetaCounts): TurnMetaLabels {
  const {
    durationMs,
    completedAt,
    usage,
    modelForCost,
    providers,
    continued = false,
    includeCacheWrite = false,
    editCount,
    fileCount,
    commandCount
  } = input;

  const stats = formatTurnStats({ editCount, fileCount, commandCount });
  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCountWithUnit(usage.cumulative.totalTokens)
      : null;
  const cacheLabel = formatTurnCacheLabel(usage, { includeCacheWrite });
  const costLabel =
    usage && modelForCost ? estimateCostForUsage(modelForCost, providers, usage.cumulative) : null;
  const durationLabel = formatDuration(durationMs);
  const timeLabel = formatWallClock(completedAt);
  const tokenTitle = tokenLabel ? `${tokenLabel} used this turn` : null;
  const veryLongTurn = durationMs >= VERY_LONG_TURN_WARN_MS;
  const longTurn = durationMs >= LONG_TURN_WARN_MS;
  const durationTitle = veryLongTurn
    ? 'This turn took unusually long — often approval waits or connection delays.'
    : longTurn
      ? 'This turn took longer than usual.'
      : undefined;

  const metaParts: string[] = [`done in ${durationLabel}`];
  if (costLabel) metaParts.push(`~${costLabel}`);
  if (tokenLabel) metaParts.push(tokenLabel);
  if (cacheLabel) metaParts.push(cacheLabel);
  metaParts.push(timeLabel);
  if (continued) metaParts.push('continued');
  if (stats.length > 0) metaParts.unshift(stats.join(' · '));

  return {
    stats,
    tokenLabel,
    cacheLabel,
    costLabel,
    timeLabel,
    durationLabel,
    tokenTitle,
    ariaLabel: metaParts.join(' · '),
    veryLongTurn,
    longTurn,
    durationTitle
  };
}
