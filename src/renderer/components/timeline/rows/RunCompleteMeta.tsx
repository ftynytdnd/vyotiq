/**
 * Run-complete metadata line — duration, optional stats, tokens, wall clock.
 */

import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import {
  timelineRunCompleteInlineClassName,
  timelineRunCompleteRowClassName
} from '../shared/rowStyles.js';
import { estimateCostForUsage, resolveModelForPrompt } from '../../../lib/workspaceSpend.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { formatDuration, formatWallClock } from './runCompleteFormat.js';

/** Turns at or above this duration get a warning tone on the elapsed label. */
const LONG_TURN_WARN_MS = 120_000;

/** Turns at or above this duration get a stronger warning + tooltip. */
const VERY_LONG_TURN_WARN_MS = 480_000;

export interface RunCompleteMetaProps {
  promptId: string;
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
  commandCount?: number;
  /** Inline beside assistant copy — omits row marker styling. */
  inline?: boolean;
  className?: string;
}

export function RunCompleteMeta({
  promptId,
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount,
  commandCount,
  inline = false,
  className
}: RunCompleteMetaProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );
  const modelForCost = resolveModelForPrompt(
    events,
    promptId,
    conversationMeta?.lastProviderId && conversationMeta?.lastModelId
      ? {
          providerId: conversationMeta.lastProviderId,
          modelId: conversationMeta.lastModelId
        }
      : null
  );

  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCountWithUnit(usage.cumulative.totalTokens)
      : null;

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
  if (cacheWriteTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(cacheWriteTokens)} cache write`);
  }
  const cacheLabel = cacheParts.length > 0 ? cacheParts.join(' · ') : null;

  const costLabel =
    usage && modelForCost
      ? estimateCostForUsage(modelForCost, providers, usage.cumulative)
      : null;

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
  if (stats.length > 0) metaParts.unshift(stats.join(' · '));
  const ariaLabel = metaParts.join(' · ');

  return (
    <div
      className={cn(
        'vx-timeline-meta min-w-0',
        !inline && 'vyotiq-stepfade-once text-text-secondary',
        inline ? timelineRunCompleteInlineClassName : timelineRunCompleteRowClassName,
        className
      )}
      data-row-kind="run-complete"
      data-run-complete-placement={inline ? 'inline' : 'footer'}
      aria-label={ariaLabel}
    >
      {stats.length > 0 ? (
        <>
          <span>{stats.join(' · ')}</span>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
        </>
      ) : null}
      <span>
        done in{' '}
        <span
          className={cn(
            veryLongTurn && 'text-warning',
            !veryLongTurn && longTurn && 'text-text-faint'
          )}
          title={durationTitle}
        >
          {durationLabel}
        </span>
      </span>
      {costLabel ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums text-text-faint" title="Estimated API cost">
            ~{costLabel}
          </span>
        </>
      ) : null}
      {tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums" title={tokenTitle ?? undefined}>
            {tokenLabel}
          </span>
        </>
      ) : null}
      {cacheLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span
            className="font-mono tabular-nums text-text-faint"
            title="Prompt tokens served from provider cache (discounted input)"
          >
            {cacheLabel}
          </span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums text-text-faint">
        {timeLabel}
      </time>
    </div>
  );
}
