/**
 * Top-level error row — terminal run failures (provider errors, etc.).
 */

import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { timelineLogRowClassName, timelineRunCompleteRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';
import { Button } from '../../ui/Button.js';
import { estimateRunCostBreakdown, estimateRunCostUsd, buildTurnUsageStatsDelta, recordRunSpendForPrompt, resolveModelForPrompt } from '../../../lib/workspaceSpend.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { buildTurnMetaLabels, resolveTurnModelForCost } from './runTurnMetaParts.js';
import type { TokenUsageAggregate } from '../reducer/types.js';

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

  const modelForCost = resolveTurnModelForCost(events, promptId, conversationMeta);
  const meta = buildTurnMetaLabels({
    durationMs,
    completedAt,
    usage,
    modelForCost,
    providers,
    editCount,
    fileCount,
    commandCount
  });

  return (
    <div
      className={cn(
        'vx-timeline-meta text-text-faint pl-6',
        timelineRunCompleteRowClassName
      )}
      aria-label={meta.ariaLabel}
    >
      {meta.stats.length > 0 ? (
        <>
          <span>{meta.stats.join(' · ')}</span>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
        </>
      ) : null}
      <span>done in {meta.durationLabel}</span>
      {meta.costLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums">~{meta.costLabel}</span>
        </>
      ) : null}
      {meta.tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums">{meta.tokenLabel}</span>
        </>
      ) : null}
      {meta.cacheLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums text-text-faint">{meta.cacheLabel}</span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums">
        {meta.timeLabel}
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
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-body text-danger">{message}</div>
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
            <Button type="button" size="sm" variant="primary" onClick={onRetry}>
              Retry last message
            </Button>
          ) : null}
          {showProviders && onOpenProviders ? (
            <Button type="button" size="sm" variant="secondary" onClick={onOpenProviders}>
              Open providers
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
