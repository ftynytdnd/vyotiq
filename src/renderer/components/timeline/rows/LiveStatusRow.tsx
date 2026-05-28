/**
 * LiveStatusRow — compact live trace line with gold phase headings
 * during tool exploration and token streaming. Timeline anchors it
 * inside the active turn when possible, with a tail fallback for
 * prompt-less in-flight states.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunStatusPhase } from '@shared/types/chat.js';
import type { SubAgentSnapshot } from '../reducer/types.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { aggregateSubAgentStatsSplit } from '../subagent/stats.js';
import {
  pickLatestSubagentId,
  scrollToSubagentRow
} from '../subagent/scrollToSubagentRow.js';
import { cn } from '../../../lib/cn.js';
import { shimmerText, shimmerStyle } from '../../../lib/shimmer.js';
import { formatTokenCount } from '../../../lib/formatTokens.js';
import {
  resolveLivePhaseHeadline,
  timelineLiveStatusRowClassName,
  timelinePhaseHeadingClassName,
  isGoldLivePhase
} from '../shared/rowStyles.js';

type DerivedPhase = RunStatusPhase | 'streaming-reasoning' | 'streaming-text';

const TICK_MS = 1000;
const DEFAULT_LABEL = 'Awaiting response…';
const CHARS_PER_TOKEN = 4;
const RATE_MIN_SECONDS = 0.5;

interface LiveStreamSnapshot {
  kind: 'reasoning' | 'text';
  text: string;
  startedAt: number;
}

interface DelegationCounters {
  running: number;
  done: number;
  failed: number;
  earlier: number;
}

function pickLiveStream(
  assistantTexts: Record<string, { done: boolean; text: string; startedAt?: number }>,
  reasoningTexts: Record<string, { done: boolean; text: string; startedAt: number }>
): LiveStreamSnapshot | null {
  let best: LiveStreamSnapshot | null = null;
  for (const id in reasoningTexts) {
    const r = reasoningTexts[id]!;
    if (r.done || r.text.length === 0) continue;
    if (!best || r.startedAt > best.startedAt) {
      best = { kind: 'reasoning', text: r.text, startedAt: r.startedAt };
    }
  }
  for (const id in assistantTexts) {
    const t = assistantTexts[id]!;
    if (t.done || t.text.length === 0) continue;
    const startedAt = t.startedAt ?? Date.now();
    if (!best || startedAt >= best.startedAt) {
      best = { kind: 'text', text: t.text, startedAt };
    }
  }
  return best;
}

function liveTokensPerSecond(snap: LiveStreamSnapshot, now: number): number | null {
  const elapsedSec = (now - snap.startedAt) / 1000;
  if (elapsedSec < RATE_MIN_SECONDS) return null;
  const tokens = snap.text.length / CHARS_PER_TOKEN;
  return tokens / elapsedSec;
}

function formatRate(tokPerSec: number): string {
  if (tokPerSec >= 100) return `${Math.round(tokPerSec)} tok/s`;
  if (tokPerSec >= 10) return `${tokPerSec.toFixed(0)} tok/s`;
  return `${tokPerSec.toFixed(1)} tok/s`;
}

function delegationCounters(
  subagents: Record<string, SubAgentSnapshot>,
  batchSinceTs?: number
): DelegationCounters | null {
  const workers = Object.values(subagents);
  const { batch, earlier } = aggregateSubAgentStatsSplit(workers, batchSinceTs);
  if (batch.total === 0 && earlier.total === 0) return null;
  return {
    running: batch.running,
    done: batch.done,
    failed: batch.failed,
    earlier: earlier.total
  };
}

function formatDelegationCounterParts(counters: DelegationCounters): string[] {
  const parts: string[] = [];
  if (counters.running > 0) parts.push(`${counters.running} running`);
  if (counters.done > 0) parts.push(`${counters.done} done (this batch)`);
  if (counters.failed > 0) parts.push(`${counters.failed} failed`);
  if (counters.earlier > 0) parts.push(`${counters.earlier} earlier`);
  return parts;
}

export function LiveStatusRow({
  suppressStreamProse = false,
  suppressStreamReasoning = false
}: {
  /** Hide when orchestrator prose streams in the response zone. */
  suppressStreamProse?: boolean;
  /** Hide when a reasoning-line row owns the thinking stream. */
  suppressStreamReasoning?: boolean;
} = {}) {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const runStartedAt = useChatStore((s) => s.runStartedAt);
  const latest = useChatStore((s) => s.latestOrchestratorRunStatus);
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const subagents = useChatStore((s) => s.subagents);
  const lastDelegationPhaseTs = useChatStore((s) => s.lastDelegationPhaseTs);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);
  const conversationId = useChatStore((s) => s.conversationId);
  const setExpanded = useTimelineUiStore((s) => s.setExpanded);

  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isProcessing) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => setTick((n) => n + 1);

    const start = () => {
      if (intervalId !== null) return;
      tick();
      intervalId = setInterval(tick, TICK_MS);
    };

    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        start();
      }
    };

    if (document.visibilityState !== 'hidden') {
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isProcessing]);

  const focusLatestSubagent = useCallback(() => {
    const latestId = pickLatestSubagentId(subagents);
    if (!latestId) return;
    if (conversationId) {
      setExpanded(conversationId, `sub:${latestId}`, true);
    }
    scrollToSubagentRow(latestId);
  }, [conversationId, setExpanded, subagents]);

  const liveStream = useMemo(
    () => pickLiveStream(assistantTexts, reasoningTexts),
    [assistantTexts, reasoningTexts]
  );

  const delegation = useMemo(
    () =>
      latest?.phase === 'delegating'
        ? delegationCounters(subagents, lastDelegationPhaseTs)
        : null,
    [latest?.phase, subagents, lastDelegationPhaseTs]
  );

  if (!isProcessing) return null;

  const now = Date.now();

  let phase: DerivedPhase;
  let phaseLabel: string;
  let anchor: number;
  let streamRate: string | null = null;
  let toolHint: string | undefined;

  if (liveStream) {
    if (liveStream.kind === 'text' && suppressStreamProse) return null;
    if (liveStream.kind === 'reasoning' && suppressStreamReasoning) return null;
    phase = liveStream.kind === 'reasoning' ? 'streaming-reasoning' : 'streaming-text';
    phaseLabel = liveStream.kind === 'reasoning' ? 'Thinking' : 'Streaming response';
    const rate = liveTokensPerSecond(liveStream, now);
    if (rate !== null) streamRate = formatRate(rate);
    anchor = liveStream.startedAt;
  } else {
    phase = latest?.phase ?? 'awaiting-response';
    phaseLabel = resolveLivePhaseHeadline(phase, latest?.label ?? DEFAULT_LABEL);
    toolHint = latest?.detail?.toolName;
    anchor = latest?.ts ?? runStartedAt ?? now;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - anchor) / 1000));
  const isDelegating = phase === 'delegating';
  const goldPhase = isGoldLivePhase(phase);

  const used = orchestratorUsage?.latest
    ? orchestratorUsage.latest.promptTokens + orchestratorUsage.latest.completionTokens
    : null;

  const counterParts: string[] = [];
  if (elapsedSeconds > 0) counterParts.push(`${elapsedSeconds}s`);
  if (streamRate) counterParts.push(streamRate);
  if (delegation) counterParts.push(...formatDelegationCounterParts(delegation));
  if (used !== null) counterParts.push(formatTokenCount(used));

  const rowClass = cn(timelineLiveStatusRowClassName);

  const label = (
    <span className="min-w-0 flex-1 truncate">
      <span
        className={
          goldPhase
            ? cn(timelinePhaseHeadingClassName(true), 'text-meta')
            : cn('vyotiq-reveal-text', shimmerText(true, 'italic'))
        }
        style={goldPhase ? undefined : shimmerStyle(`live-status:${phase}`)}
      >
        {phaseLabel}
      </span>
      {toolHint && phase === 'running-tool' && (
        <span className="ml-1.5 font-mono text-text-faint">· {toolHint}</span>
      )}
      {counterParts.length > 0 && (
        <span className="ml-2 font-mono tabular-nums text-text-faint/80">
          {counterParts.join(' · ')}
        </span>
      )}
    </span>
  );

  if (isDelegating) {
    return (
      <button
        type="button"
        data-row-kind="live-status"
        aria-label="Scroll to latest sub-agent"
        onClick={focusLatestSubagent}
        className={cn(rowClass, 'text-left hover:bg-surface-hover/40')}
      >
        <span role="status" aria-live="polite" className="contents">
          {label}
        </span>
      </button>
    );
  }

  return (
    <div role="status" data-row-kind="live-status" aria-live="polite" className={rowClass}>
      {label}
    </div>
  );
}
