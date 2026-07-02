/**
 * Sticky per-turn footer — live run telemetry while processing, then
 * run-complete content while scrolling a long turn.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { formatTokenCount, formatTokenCountUsed } from '../../../lib/formatTokens.js';
import {
  LONG_TURN_WARN_MS,
  VERY_LONG_TURN_WARN_MS
} from '@shared/timeline/longTurnThresholds.js';
import {
  formatLiveTokenRate,
  resolveLiveCompletionTokens
} from '../../../lib/liveTokenRate.js';
import { useLiveTokenRate } from '../../../lib/useLiveTokenRate.js';
import { cn } from '../../../lib/cn.js';
import { timelineRunCompleteRowClassName, timelinePhaseHeadingClassName } from './rowStyles.js';
import { detectLiveRunActivity } from './detectLiveRunActivity.js';
import { resolveStickyFooterLiveLabel } from './resolveStickyFooterLiveLabel.js';

interface TurnStickyFooterProps {
  live?: boolean;
  promptId?: string;
  /** Run-complete meta moved inline — drop extra footer spacing. */
  compact?: boolean;
  children: ReactNode;
}

export function TurnStickyFooter({
  live = false,
  promptId,
  compact = false,
  children
}: TurnStickyFooterProps) {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const events = useChatStore((s) => s.events);
  const usage = useChatStore((s) => s.orchestratorUsage);
  const awaitingAskUser = useChatStore((s) => s.awaitingAskUser);
  const latestStatus = useChatStore((s) => (live ? s.latestOrchestratorRunStatus : undefined));
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const partialToolCallArgs = useChatStore((s) => s.partialToolCallArgs);
  const toolResultSettledIds = useChatStore((s) => s.toolResultSettledIds);
  const [now, setNow] = useState(() => Date.now());

  const { promptTs, runId } = useMemo(() => {
    if (!promptId) return { promptTs: null as number | null, runId: null as string | null };
    for (const e of events) {
      if (e.kind === 'user-prompt' && e.id === promptId) {
        return {
          promptTs: e.ts,
          runId: typeof e.runId === 'string' && e.runId.length > 0 ? e.runId : null
        };
      }
    }
    return { promptTs: null, runId: null };
  }, [events, promptId]);

  const fileEditCount = useChatStore((s) =>
    runId ? (s.runIdToFileEditCount[runId] ?? 0) : 0
  );

  const showLive = Boolean(
    live && (isProcessing || awaitingAskUser) && promptTs !== null
  );

  useEffect(() => {
    if (!showLive) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [showLive]);

  const elapsedMs = showLive && promptTs !== null ? Math.max(0, now - promptTs) : 0;
  const completionTokens = resolveLiveCompletionTokens(usage);
  const liveTokenRate = useLiveTokenRate(showLive, completionTokens);
  const liveTokenRateLabel =
    liveTokenRate !== null && liveTokenRate > 0 ? formatLiveTokenRate(liveTokenRate) : null;
  const tokenLabel =
    showLive && usage && usage.cumulative.totalTokens > 0
      ? awaitingAskUser
        ? formatTokenCountUsed(usage.cumulative.totalTokens)
        : `${formatTokenCount(usage.cumulative.totalTokens)} run total`
      : null;
  const throughputLabel =
    showLive && elapsedMs >= LONG_TURN_WARN_MS
      ? liveTokenRateLabel ?? tokenLabel
      : null;

  const elapsedWarn =
    showLive && !awaitingAskUser && elapsedMs >= LONG_TURN_WARN_MS
      ? elapsedMs >= VERY_LONG_TURN_WARN_MS
        ? 'very-long'
        : 'long'
      : null;

  const activity = useMemo(
    () =>
      detectLiveRunActivity({
        isProcessing: showLive,
        reasoningTexts,
        assistantTexts,
        partialToolCallArgs,
        events,
        toolResultSettledIds
      }),
    [
      showLive,
      reasoningTexts,
      assistantTexts,
      partialToolCallArgs,
      events,
      toolResultSettledIds
    ]
  );

  const liveLabel = resolveStickyFooterLiveLabel({
    awaitingAskUser: showLive && awaitingAskUser,
    ...(latestStatus ? { latestStatus } : {}),
    activity,
    fileEditCount,
    elapsedMs,
    tokenLabel: throughputLabel
  });

  return (
    <div
      className={cn('vx-turn-sticky-footer', compact && 'vx-turn-sticky-footer--compact')}
      data-turn-sticky-footer
      {...(compact ? { 'data-turn-footer-compact': '' } : {})}
    >
      {showLive ? (
        <div
          className={cn(
            'vx-turn-sticky-footer__live vx-timeline-meta text-text-faint',
            timelineRunCompleteRowClassName
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={cn(
              awaitingAskUser
                ? 'font-medium text-text-secondary'
                : timelinePhaseHeadingClassName(true)
            )}
          >
            {liveLabel.headline}
          </span>
          {liveLabel.detailParts.map((part, i) => (
            <span key={part} className="contents">
              <span aria-hidden className="text-text-faint/70">
                {' · '}
              </span>
              <span
                className={cn(
                  i === 0 && 'tabular-nums',
                  i > 0 && 'font-mono tabular-nums',
                  i === 0 &&
                    elapsedWarn === 'long' &&
                    'text-text-faint/90',
                  i === 0 && elapsedWarn === 'very-long' && 'text-warning'
                )}
                {...(i === 0 && elapsedWarn === 'very-long'
                  ? {
                      title:
                        'This turn is taking unusually long — approval waits or connection delays may be involved'
                    }
                  : {})}
              >
                {part}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="vx-turn-sticky-footer__body">{children}</div>
    </div>
  );
}
