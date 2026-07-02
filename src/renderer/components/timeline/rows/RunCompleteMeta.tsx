/**
 * Run-complete metadata line — duration, optional stats, tokens, wall clock.
 */

import { cn } from '../../../lib/cn.js';
import {
  timelineRunCompleteInlineClassName,
  timelineRunCompleteRowClassName
} from '../shared/rowStyles.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import {
  buildTurnMetaLabels,
  resolveTurnModelForCost
} from './runTurnMetaParts.js';

export interface RunCompleteMetaProps {
  promptId: string;
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
  commandCount?: number;
  continued?: boolean;
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
  continued = false,
  inline = false,
  className
}: RunCompleteMetaProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );
  const modelForCost = resolveTurnModelForCost(events, promptId, conversationMeta);
  const meta = buildTurnMetaLabels({
    durationMs,
    completedAt,
    usage,
    modelForCost,
    providers,
    continued,
    includeCacheWrite: true,
    editCount,
    fileCount,
    commandCount
  });

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
      <span>
        done in{' '}
        <span
          className={cn(
            meta.veryLongTurn && 'text-warning',
            !meta.veryLongTurn && meta.longTurn && 'text-text-faint'
          )}
          title={meta.durationTitle}
        >
          {meta.durationLabel}
        </span>
      </span>
      {meta.costLabel ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums text-text-faint" title="Estimated API cost">
            ~{meta.costLabel}
          </span>
        </>
      ) : null}
      {meta.tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums" title={meta.tokenTitle ?? undefined}>
            {meta.tokenLabel}
          </span>
        </>
      ) : null}
      {meta.cacheLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span
            className="font-mono tabular-nums text-text-faint"
            title="Prompt tokens served from provider cache (discounted input)"
          >
            {meta.cacheLabel}
          </span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums text-text-faint">
        {meta.timeLabel}
      </time>
      {continued ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="text-text-faint">continued</span>
        </>
      ) : null}
    </div>
  );
}
