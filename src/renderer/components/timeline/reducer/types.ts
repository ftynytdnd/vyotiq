/**
 * Shared types for the renderer-side timeline reducer. Kept in a separate
 * file so both the reducer implementation and the stores can import them
 * without creating a cycle.
 */

import type { TimelineEvent, TokenUsage } from '@shared/types/chat.js';
import type { DiffHunk } from '@shared/types/tool.js';

export interface AssistantTextAcc {
  id: string;
  text: string;
  done: boolean;
  /**
   * Wall-clock timestamp of the first `agent-text-delta` for this id.
   * Powers the live tok/s readout in `LiveStatusRow` while text is
   * streaming; calculated as `chars/4 / max(now - startedAt, 0.5s)`.
   * Stamped once on first delta and never overwritten — spread order
   * in the reducer guarantees the original anchor survives subsequent
   * delta merges.
   */
  startedAt?: number;
}

export interface ReasoningTextAcc {
  id: string;
  text: string;
  done: boolean;
  /**
   * Wall-clock timestamps for the reasoning stream.
   *
   * `startedAt` is set the first time a delta lands for this id; `endedAt`
   * is set when the matching `agent-reasoning-end` event arrives. The
   * row renderer subtracts these to display a real elapsed-seconds
   * count instead of a heuristic derived from character count.
   */
  startedAt: number;
  endedAt?: number;
}

/**
 * Live partial-args snapshot for a streaming tool call. Populated by
 * `tool-call-args-delta` events as the model streams the arguments
 * JSON, then cleared the moment the authoritative `tool-call` event
 * lands (carrying the fully-parsed `args` object). Pure live
 * telemetry — never persisted to the JSONL transcript.
 */
export interface PartialToolCallArgs {
  callId: string;
  name?: string;
  index: number;
  argsBuf: string;
  parsed: Record<string, unknown> | null;
  /** Wall-clock of the most recent args-delta. */
  ts: number;
  /**
   * FS-aware live diff for this in-flight tool call (Phase 2).
   * Populated by the main-process diff streamer when the call
   * targets a known file body.
   */
  diffStream?: DiffStreamSnapshot;
}

/**
 * Cached FS-aware diff snapshot the main process streams in via
 * `diff-stream` events.
 */
export interface DiffStreamSnapshot {
  tool: 'edit' | 'delete' | 'bash' | 'report';
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** Authoritative `tool-call` has landed; renderer flips to settled style. */
  settled: boolean;
  /** Wall-clock of the latest `diff-stream` event for this callId. */
  ts: number;
}

/**
 * Rolling token-usage aggregation for the orchestrator turn.
 */
export interface TokenUsageAggregate {
  latest: TokenUsage;
  peak: TokenUsage;
  cumulative: TokenUsage;
  /** Count of usage events folded in. Useful for empty-state checks. */
  samples: number;
  inFlight?: TokenUsage;
  streamStartedAt?: number;
  streamEndedAt?: number;
}

/**
 * The canonical renderer-side timeline state. A pure function of the
 * persisted TimelineEvent[]. Rebuilt on transcript load; incrementally
 * advanced by each live event.
 */
export interface TimelineState {
  events: TimelineEvent[];
  assistantTexts: Record<string, AssistantTextAcc>;
  reasoningTexts: Record<string, ReasoningTextAcc>;
  /** Aggregated token usage for the active Agent V run. */
  orchestratorUsage?: TokenUsageAggregate;
  /**
   * Latest orchestrator-scoped `run-status` event.
   */
  latestOrchestratorRunStatus?: Extract<TimelineEvent, { kind: 'run-status' }>;
  lastUserPromptId?: string;
  lastUserPromptContent?: string;
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
  settledCallIds: Record<string, true>;
  liveDiffByCallId: Record<string, DiffStreamSnapshot>;
  toolResultSettledIds: Record<string, true>;
  runIdToFileEditCount: Record<string, number>;
}

export const INITIAL_TIMELINE_STATE: TimelineState = {
  events: [],
  assistantTexts: {},
  reasoningTexts: {},
  partialToolCallArgs: {},
  settledCallIds: {},
  liveDiffByCallId: {},
  toolResultSettledIds: {},
  runIdToFileEditCount: {}
};

export function foldTokenUsage(
  prior: TokenUsageAggregate | undefined,
  next: TokenUsage,
  ts?: number
): TokenUsageAggregate {
  if (!prior) {
    return {
      latest: next,
      peak: next,
      cumulative: next,
      samples: 1,
      ...(typeof ts === 'number' ? { streamEndedAt: ts } : {})
    };
  }
  const peak: TokenUsage = {
    promptTokens: Math.max(prior.peak.promptTokens, next.promptTokens),
    completionTokens: Math.max(prior.peak.completionTokens, next.completionTokens),
    totalTokens: Math.max(prior.peak.totalTokens, next.totalTokens)
  };
  const peakReasoning = maxOpt(prior.peak.reasoningTokens, next.reasoningTokens);
  if (peakReasoning !== undefined) peak.reasoningTokens = peakReasoning;
  const peakCached = maxOpt(prior.peak.cachedPromptTokens, next.cachedPromptTokens);
  if (peakCached !== undefined) peak.cachedPromptTokens = peakCached;
  const peakCacheCreation = maxOpt(prior.peak.cacheCreationTokens, next.cacheCreationTokens);
  if (peakCacheCreation !== undefined) peak.cacheCreationTokens = peakCacheCreation;

  const cumulative: TokenUsage = {
    promptTokens: prior.cumulative.promptTokens + next.promptTokens,
    completionTokens: prior.cumulative.completionTokens + next.completionTokens,
    totalTokens: prior.cumulative.totalTokens + next.totalTokens
  };
  const cumReasoning = sumOpt(prior.cumulative.reasoningTokens, next.reasoningTokens);
  if (cumReasoning !== undefined) cumulative.reasoningTokens = cumReasoning;
  const cumCached = sumOpt(prior.cumulative.cachedPromptTokens, next.cachedPromptTokens);
  if (cumCached !== undefined) cumulative.cachedPromptTokens = cumCached;
  const cumCacheCreation = sumOpt(
    prior.cumulative.cacheCreationTokens,
    next.cacheCreationTokens
  );
  if (cumCacheCreation !== undefined) cumulative.cacheCreationTokens = cumCacheCreation;

  const out: TokenUsageAggregate = {
    latest: next,
    peak,
    cumulative,
    samples: prior.samples + 1
  };
  if (typeof prior.streamStartedAt === 'number') {
    out.streamStartedAt = prior.streamStartedAt;
  }
  if (typeof ts === 'number') out.streamEndedAt = ts;
  else if (typeof prior.streamEndedAt === 'number') out.streamEndedAt = prior.streamEndedAt;
  return out;
}

export function stampUsageStart(
  prior: TokenUsageAggregate | undefined,
  ts: number
): TokenUsageAggregate {
  if (prior && typeof prior.streamStartedAt === 'number') return prior;
  const zero: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (!prior) {
    return {
      latest: zero,
      peak: zero,
      cumulative: zero,
      samples: 0,
      streamStartedAt: ts
    };
  }
  return { ...prior, streamStartedAt: ts };
}

function maxOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

export function setInFlightUsage(
  prior: TokenUsageAggregate | undefined,
  next: TokenUsage | undefined
): TokenUsageAggregate {
  if (!prior) {
    const zero: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    return {
      latest: zero,
      peak: zero,
      cumulative: zero,
      samples: 0,
      ...(next !== undefined ? { inFlight: next } : {})
    };
  }
  const out: TokenUsageAggregate = {
    latest: prior.latest,
    peak: prior.peak,
    cumulative: prior.cumulative,
    samples: prior.samples
  };
  if (next !== undefined) out.inFlight = next;
  return out;
}
