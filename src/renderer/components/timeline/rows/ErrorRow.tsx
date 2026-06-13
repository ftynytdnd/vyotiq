/**
 * Top-level error row — terminal run failures (provider errors, etc.).
 */

import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { timelineLogRowClassName, timelineRunCompleteRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';
import { Button } from '../../ui/Button.js';
import { formatDuration, formatWallClock } from './RunCompleteRow.js';
import { estimateCostForUsage, estimateRunCostBreakdown, estimateRunCostUsd, buildTurnUsageStatsDelta, recordRunSpendForPrompt, resolveModelForPrompt } from '../../../lib/workspaceSpend.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';

interface ErrorRowProps {
  message: string;
  promptId?: string;
  durationMs?: number;
  completedAt?: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
  commandCount?: number;
  onRetry?: () => void;
  onOpenProviders?: () => void;
  showProviders?: boolean;
}

function ErrorRunMeta({
  promptId,
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount,
  commandCount
}: Pick<
  ErrorRowProps,
  'promptId' | 'durationMs' | 'completedAt' | 'usage' | 'editCount' | 'fileCount' | 'commandCount'
>) {
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );

  if (durationMs === undefined || completedAt === undefined) return null;

  const modelForCost =
    promptId !== undefined
      ? resolveModelForPrompt(
          events,
          promptId,
          conversationMeta?.lastProviderId && conversationMeta?.lastModelId
            ? {
                providerId: conversationMeta.lastProviderId,
                modelId: conversationMeta.lastModelId
              }
            : null
        )
      : null;

  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCountWithUnit(usage.cumulative.totalTokens)
      : null;

  const costLabel =
    usage && modelForCost ? estimateCostForUsage(modelForCost, providers, usage.cumulative) : null;

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

  const cachedTokens = usage?.cumulative.cachedPromptTokens ?? 0;
  const uncachedTokens = usage?.cumulative.uncachedPromptTokens ?? 0;
  const cacheParts: string[] = [];
  if (cachedTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(cachedTokens)} cached`);
  }
  if (uncachedTokens > 0) {
    cacheParts.push(`${formatTokenCountWithUnit(uncachedTokens)} uncached`);
  }
  const cacheLabel = cacheParts.length > 0 ? cacheParts.join(' · ') : null;

  const timeLabel = formatWallClock(completedAt);

  return (
    <div
      className={cn(
        'vx-timeline-meta text-text-faint pl-6',
        timelineRunCompleteRowClassName
      )}
      aria-label={[
        stats.length > 0 ? stats.join(' · ') : null,
        `done in ${formatDuration(durationMs)}`,
        costLabel ? `~${costLabel}` : null,
        tokenLabel,
        cacheLabel,
        timeLabel
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {stats.length > 0 ? (
        <>
          <span>{stats.join(' · ')}</span>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
        </>
      ) : null}
      <span>done in {formatDuration(durationMs)}</span>
      {costLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums">~{costLabel}</span>
        </>
      ) : null}
      {tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums">{tokenLabel}</span>
        </>
      ) : null}
      {cacheLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums text-text-faint">{cacheLabel}</span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums">
        {timeLabel}
      </time>
    </div>
  );
}

export function ErrorRow({
  message,
  promptId,
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount,
  commandCount,
  onRetry,
  onOpenProviders,
  showProviders = false
}: ErrorRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );
  const workspaceId = conversationMeta?.workspaceId ?? null;

  const modelForCost =
    promptId !== undefined
      ? resolveModelForPrompt(
          events,
          promptId,
          conversationMeta?.lastProviderId && conversationMeta?.lastModelId
            ? {
                providerId: conversationMeta.lastProviderId,
                modelId: conversationMeta.lastModelId
              }
            : null
        )
      : null;
  const costUsd =
    usage && modelForCost && usage.cumulative.totalTokens > 0
      ? estimateRunCostUsd(modelForCost, providers, usage.cumulative)
      : null;
  const costBreakdown =
    usage && modelForCost
      ? estimateRunCostBreakdown(modelForCost, providers, usage.cumulative)
      : null;

  const spendRecordedRef = useRef(false);
  useEffect(() => {
    if (spendRecordedRef.current || costUsd === null || !promptId) return;
    if (!workspaceId && !conversationId) return;
    spendRecordedRef.current = true;
    const stats = buildTurnUsageStatsDelta(usage!.cumulative, costBreakdown);
    void recordRunSpendForPrompt(workspaceId, conversationId, promptId, costUsd, stats);
  }, [workspaceId, conversationId, costUsd, costBreakdown, promptId, usage]);

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once vx-timeline-error-row',
        timelineLogRowClassName,
        'flex-col gap-2'
      )}
      data-row-kind="error"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className={cn(SHELL_ROW_ICON_CLASS, 'mt-0.5 shrink-0 text-danger')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-row text-danger">{message}</div>
      </div>
      <ErrorRunMeta
        promptId={promptId}
        durationMs={durationMs}
        completedAt={completedAt}
        usage={usage}
        editCount={editCount}
        fileCount={fileCount}
        commandCount={commandCount}
      />
      {(onRetry || (showProviders && onOpenProviders)) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {onRetry ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              Retry last message
            </Button>
          ) : null}
          {showProviders && onOpenProviders ? (
            <Button type="button" size="sm" variant="link" onClick={onOpenProviders}>
              Open providers
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
