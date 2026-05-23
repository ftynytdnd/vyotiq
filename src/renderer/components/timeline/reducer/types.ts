/**
 * Shared types for the renderer-side timeline reducer. Kept in a separate
 * file so both the reducer implementation and the stores can import them
 * without creating a cycle.
 */

import type { TimelineEvent, TokenUsage } from '@shared/types/chat.js';
import type {
  ContextMessageOverride,
  PersistedSummaryConfig
} from '@shared/types/contextSummary.js';
import type { DiffHunk, ToolCall, ToolResult } from '@shared/types/tool.js';

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
 * Lifecycle states for a sub-agent surface in the renderer.
 *
 * - `pending`: the orchestrator has emitted a `<delegate />` directive
 *   mid-stream but the pool has not actually spawned the worker yet.
 *   Used for the headline "live sub-agent visibility" row that appears
 *   the instant the directive is parsed instead of after the orchestrator
 *   turn ends.
 * - `running`: the sub-agent has spawned and is executing. Most live
 *   telemetry (`tool-call`, `tool-result`, `file-edit`, `token-usage`)
 *   accumulates against snapshots in this state.
 * - `done`: worker reported `<status>success</status>` and the verifier
 *   accepted it.
 * - `partial`: worker reported `<status>partial</status>` (T1-6). Real
 *   progress landed but the task is not complete. Distinct from `done`
 *   so the UI can surface it with a softer-tone badge.
 * - `failed`: worker reported `<status>failed</status>`, emitted a
 *   malformed envelope, or the host gave up.
 * - `aborted`: user Stop or supersede.
 */
type SubAgentStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'partial'
  | 'failed'
  | 'malformed'
  | 'aborted';

export interface SubAgentStep {
  callId: string;
  call?: ToolCall;
  result?: ToolResult;
  startedAt: number;
  endedAt?: number;
}

interface SubAgentFileEdit {
  key: string;
  filePath: string;
  additions: number;
  deletions: number;
  ts: number;
}

/**
 * Live partial-args snapshot for a streaming tool call. Populated by
 * `tool-call-args-delta` events as the model streams the arguments
 * JSON, then cleared the moment the authoritative `tool-call` event
 * lands (carrying the fully-parsed `args` object). Pure live
 * telemetry — never persisted to the JSONL transcript.
 *
 * `argsBuf` is the cumulative raw partial JSON (latest delta wins),
 * `parsed` is the best-effort `Record<string, unknown>` snapshot from
 * `PartialJsonParser` (or `null` when the buffer hasn't yet matched
 * any valid prefix). Renderers prefer `parsed` for synthesis but can
 * fall back to `argsBuf` for diagnostics.
 */
export interface PartialToolCallArgs {
  callId: string;
  name?: string;
  index: number;
  argsBuf: string;
  parsed: Record<string, unknown> | null;
  /** Wall-clock of the most recent delta. Drives shimmer keying. */
  ts: number;
  subagentId?: string;
  /**
   * FS-aware live diff for this in-flight tool call (Phase 2).
   * Populated by the main-process diff streamer when the call
   * targets a known file body. Renderer prefers these hunks over
   * the renderer-side `synthesizeDiffPreview` output because they
   * reflect the actual on-disk file body, not just the model's
   * `oldString` / `newString`. Cleared alongside the rest of the
   * partial entry on the matching `tool-call` reconciliation.
   */
  diffStream?: DiffStreamSnapshot;
}

/**
 * Cached FS-aware diff snapshot the main process streams in via
 * `diff-stream` events. The reducer attaches this to the matching
 * `partialToolCallArgs` entry so all the existing partial-tool-group
 * rendering picks it up without a parallel data path.
 */
export interface DiffStreamSnapshot {
  /** Source tool emitting the stream — `edit`, `delete`, or `bash`-write. */
  tool: 'edit' | 'delete' | 'bash';
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
 * Rolling token-usage aggregation for a single owner (the orchestrator
 * or a specific sub-agent). `latest` reflects the most recent turn's
 * usage — the "how full is this context window right now" signal.
 * `peak` is the running maximum of `promptTokens` seen across turns —
 * the high-water mark. `cumulative` sums every prompt+completion
 * reported across iterations — the billing / cost view.
 *
 * `inFlight` is a synthetic, locally-tokenized estimate of the tokens
 * generated since the last authoritative `token-usage` event landed
 * (Phase 3 — `synthetic-usage-update`). It lets the composer pill grow
 * during long generations on providers whose `usage` only arrives at
 * end-of-turn. Cleared the instant a real `token-usage` event lands and
 * also on terminal events (`agent-text-end`, abort, run done/error).
 * Never persisted; never folded into `peak` or `cumulative`.
 */
export interface TokenUsageAggregate {
  latest: TokenUsage;
  peak: TokenUsage;
  cumulative: TokenUsage;
  /** Count of usage events folded in. Useful for empty-state checks. */
  samples: number;
  /**
   * Synthetic in-flight estimate (Phase 3). Only `completionTokens` is
   * populated by the synthetic counter; the prompt side stays
   * authoritative from the last real `latest`.
   */
  inFlight?: TokenUsage;
  /**
   * Phase 12 (2026) — wall-clock anchor for tok/s throughput:
   *
   *   - `streamStartedAt`: timestamp of the FIRST `agent-text-delta`
   *     or `agent-reasoning-delta` for this owner (orchestrator or
   *     sub-agent). Stamped once and never overwritten so a long
   *     multi-turn run reports the run-level throughput, not the
   *     last turn alone.
   *   - `streamEndedAt`: timestamp of the LATEST `token-usage` event
   *     for this owner. Advances on every authoritative usage frame
   *     so the renderer's "tok/s" pill keeps creeping up as more
   *     turns complete.
   *
   * Both fields are wall-clock milliseconds (Date.now() / event.ts).
   * The renderer derives `tok/s = completion_tokens / ((end - start)
   * / 1000)` for the visible-output throughput. Hidden chain-of-
   * thought tokens are NOT included — `peak.completionTokens` already
   * counts only visible output on dialects we support, and a user-
   * facing tok/s that mixed in reasoning would understate the
   * apparent typing speed they perceive in the stream.
   *
   * Both undefined until the first delta lands; both stay undefined
   * for non-streaming providers that report usage in a single shot
   * with no preceding text deltas (so the renderer hides the pill
   * rather than divide-by-zero).
   */
  streamStartedAt?: number;
  streamEndedAt?: number;
}

/**
 * Latest per-sub-agent `run-status` event the main process has emitted.
 * Mirrors the orchestrator-level `LiveStatusRow` signal but scoped to
 * ONE worker so parallel sub-agents each get their own breathing
 * status line under the matching trace card. Updated only while the
 * snapshot is in the `running` state; terminal transitions clear it.
 */
interface SubAgentLiveStatus {
  /** `connecting` / `awaiting-response` / `running-tool` / `retrying`. */
  phase: string;
  label: string;
  ts: number;
}

export interface SubAgentSnapshot {
  id: string;
  task: string;
  files: string[];
  /**
   * Paths the orchestrator's pre-spawn validator could not resolve
   * against the active workspace FS — typically model-invented paths
   * the agent imagined for the task (see screenshot §1: `core/agent.py`
   * in a TypeScript repo). Surfaced as a separate slot so the renderer
   * can mark these chips as `not found` (strikethrough + muted tone)
   * alongside the resolvable `files` chips. Empty array for the
   * common all-resolved case.
   */
  missingFiles: string[];
  /**
   * Tools granted to this sub-agent by the `<delegate tools="…" />`
   * directive. Emitted on `subagent-pending` and carried through the
   * snapshot's lifetime so the UI can surface the allowlist.
   */
  tools: string[];
  status: SubAgentStatus;
  message?: string;
  output?: string;
  startedAt: number;
  endedAt?: number;
  steps: SubAgentStep[];
  fileEdits: SubAgentFileEdit[];
  /**
   * Aggregated token usage across every iteration of this sub-agent.
   * Populated once the provider has reported at least one usage frame
   * (requires `stream_options.include_usage` to be honored upstream).
   */
  usage?: TokenUsageAggregate;
  /**
   * Latest live-status phase for this worker (undefined before the
   * first event and after a terminal transition). Drives an inline
   * shimmer label under the sub-agent's header while the worker is
   * running. See `SubAgentLiveStatus` for the shape and the
   * `run-status` case in `applyTimelineEvent` for the routing rule.
   */
  liveStatus?: SubAgentLiveStatus;
  /**
   * Per-iteration assistant text accumulators for THIS worker. Keyed
   * by the `assistantMsgId` minted in `runSubAgent` for each
   * iteration of the worker's tool-loop. Mirrors the orchestrator-
   * level `TimelineState.assistantTexts` shape so the same renderer
   * primitives (markdown body, stopwatch math) can drop in unchanged.
   * Audit fix §1.1.
   */
  assistantTexts: Record<string, AssistantTextAcc>;
  /**
   * Per-iteration reasoning accumulators for THIS worker. Same shape
   * and lifecycle as `assistantTexts`. Audit fix §1.1.
   */
  reasoningTexts: Record<string, ReasoningTextAcc>;
  /**
   * Insertion-ordered list of per-iteration accumulator ids on this
   * worker. Lets the renderer walk reasoning + text bodies in the
   * order they streamed instead of trusting `Object.keys` iteration
   * order (which is technically defined for string keys but reads
   * as fragile). Audit fix §1.1.
   */
  iterationOrder: string[];
  /**
   * Live partial-args snapshots keyed by `callId` for tool calls this
   * sub-agent has begun streaming but not yet finalized. Populated by
   * `tool-call-args-delta`; entries are removed on the matching final
   * `tool-call` event or when the run aborts. Always `{}` after replay.
   */
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
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
  subagents: Record<string, SubAgentSnapshot>;
  /**
   * Aggregated usage for the orchestrator's own turns (events with no
   * `subagentId`). The composer pill reads `latest.promptTokens +
   * latest.completionTokens` for its "used so far this turn" display.
   */
  orchestratorUsage?: TokenUsageAggregate;
  /**
   * Latest orchestrator-scoped `run-status` event. Tracked as a
   * dedicated slot rather than appended to `events` so that a flurry
   * of phase transitions (5–10× per iteration: `preparing-turn` →
   * `connecting` → `awaiting-response` → `running-tool` → …) does
   * NOT churn the `events` array reference and re-trigger
   * `deriveRows`'s full O(n) walk on every flip. Sub-agent-scoped
   * status events are routed into the matching snapshot's
   * `liveStatus` slot in the same vein (see `applyTimelineEvent`'s
   * `run-status` branch). Audit fix §3.2.1.
   */
  latestOrchestratorRunStatus?: Extract<TimelineEvent, { kind: 'run-status' }>;
  /** Workers with `startedAt >=` this timestamp count toward batch-scoped stats. */
  lastDelegationPhaseTs?: number;
  /**
   * Id of the most-recent `user-prompt` event. Maintained by the
   * reducer so `Timeline`'s "snap on send" effect can depend on a
   * primitive that flips ONLY when a new prompt is committed, instead
   * of re-running on every streaming delta and reverse-scanning
   * `events` on each pass. Audit fix §3.2.2.
   */
  lastUserPromptId?: string;
  /**
   * Content of the most-recent `user-prompt` event. Maintained by the
   * reducer alongside `lastUserPromptId` so consumers (e.g. the
   * `Regenerate` affordance on `AssistantTextRow`) can read the last
   * prompt as a primitive O(1) lookup instead of reverse-scanning
   * `events`. Audit fix C2.
   */
  lastUserPromptContent?: string;
  /**
   * Live partial-args snapshots keyed by `callId` for orchestrator-
   * level tool calls (sub-agent calls live on the matching snapshot,
   * not here). Populated by `tool-call-args-delta` events; entries
   * are removed on the matching final `tool-call`. Always `{}` after
   * replay since the deltas are not persisted.
   */
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
  /**
   * CallIds whose authoritative `tool-call` event has already been
   * applied. Used by the `tool-call-args-delta` and `diff-stream`
   * branches to drop late frames that race the synchronous
   * tool-call dispatch (the args-delta path goes through a RAF
   * batcher in `chatChannel`, so an arg-delta enqueued before the
   * `tool-call` can drain ONE frame after the tool-call cleared
   * the partial entry — without this guard the late delta would
   * resurrect an orphan partial entry that survives until the next
   * event lands). Audit fix H3. Always `{}` for fresh state; on
   * replay the tool-calls in the persisted transcript repopulate
   * it as they're applied.
   */
  settledCallIds: Record<string, true>;
  /**
   * Per-runId count of `file-edit` events applied to the transcript.
   * Captures the full per-turn FS impact (orchestrator edits + every
   * delegated sub-agent's edits, since sub-agent file-edits inherit
   * the parent run's `runId`). Drives the inline numeric badge on
   * `UserPromptRow`'s Revert affordance so users can see how many
   * files a turn touched without opening the rewind preview modal.
   *
   * Only populated when the file-edit event carries a non-empty
   * `runId` — older transcripts persisted before the field was added
   * still deserialise (the badge simply renders no count for those
   * legacy turns; the rewind heuristic still resolves the manifest
   * via `(conversationId, startedAt ≈ promptTs)`).
   */
  runIdToFileEditCount: Record<string, number>;
  /**
   * Per-summary streaming + lifecycle accumulator keyed by
   * `summaryId`. Populated by `context-summary-pending`, advanced
   * by every `context-summary-delta` /
   * `context-summary-reasoning-delta` until either an `-end` (terminal
   * with `finalText`) or `-aborted` (terminal with `reason`) arrives.
   * `context-summary-undone` flips `undone: true` on the matching
   * entry without removing it — the inline timeline card still
   * renders so the user can see "you undid this" history. The
   * Inspector panel reads this map to drive its live-stream card
   * + progress gauge.
   *
   * Always `{}` after a fresh load before any events replay.
   */
  summaries: Record<string, ContextSummaryAcc>;
  /**
   * Per-conversation per-message override map. Keyed by stable
   * `messageId` (from `messageWindow.identify`). Maintained by
   * `context-override-set` events; reset by the `'*'` sentinel.
   * Mirrors the main-side `overrideStore` so the renderer can
   * render the Inspector's per-row toggle state without a round-
   * trip on every paint. The reducer applies the events; the
   * resulting map is passed up to `useChatStore` and from there
   * to the Inspector.
   */
  messageOverrides: Record<string, ContextMessageOverride>;
}

/**
 * Streaming accumulator for ONE in-flight or completed
 * context-summary. Built by the reducer from the
 * `context-summary-*` family of TimelineEvents. Discriminator-style
 * `status` field so renderers can switch on the four terminal
 * states without juggling `undefined`s.
 */
export interface ContextSummaryAcc {
  summaryId: string;
  /** Wall-clock when the `-pending` event landed. */
  startedAt: number;
  /** Half-open index range from `-pending`. Surface-only — the
   *  authoritative handle is `replacedMessageIds`. */
  range: { startIdx: number; endIdx: number };
  /** Stable ids being replaced. */
  replacedMessageIds: ReadonlyArray<string>;
  /** Stable ids the user marked `'drop'` that are consumed by
   *  this summary. */
  droppedMessageIds: ReadonlyArray<string>;
  /** Estimated tokens of the summarizable range BEFORE compression. */
  beforeTokens: number;
  /** Configuration snapshot from `-pending`. */
  config: PersistedSummaryConfig;
  /** Live accumulating summary body. Filled by
   *  `context-summary-delta`. */
  text: string;
  /** Live accumulating reasoning body (if the summarizer model
   *  emits `reasoning_content`). */
  reasoningText: string;
  /** Wall-clock of the FIRST `context-summary-delta` for this id;
   *  drives the streaming-tok/s readout in the live card. */
  textStartedAt?: number;
  /** Wall-clock of the FIRST `context-summary-reasoning-delta`. */
  reasoningStartedAt?: number;
  /** Lifecycle status. The renderer's live card switches on this. */
  status: 'pending' | 'streaming' | 'ended' | 'aborted';
  /** True when a `context-summary-undone` landed for this id.
   *  Independent of `status` — an `ended` summary that was undone
   *  still renders, with the "Undone" badge instead of the
   *  "Apply" affordance. */
  undone: boolean;
  /** Set on `-end`. Final compressed body (truncated to the cap). */
  finalText?: string;
  /** Set on `-end`. Post-compression token estimate. */
  afterTokens?: number;
  /** Set on `-end`. `(before - after) / before` rounded to 1 dec. */
  savedPercent?: number;
  /** Set on `-aborted`. User-facing failure reason. */
  reason?: string;
}

export const INITIAL_TIMELINE_STATE: TimelineState = {
  events: [],
  assistantTexts: {},
  reasoningTexts: {},
  subagents: {},
  partialToolCallArgs: {},
  settledCallIds: {},
  runIdToFileEditCount: {},
  summaries: {},
  messageOverrides: {}
};

/**
 * Folds a single `TokenUsage` report into a running aggregate.
 * Pure; returns a new aggregate when the prior is undefined or when
 * any field changes.
 *
 * Authoritative usage events ALWAYS clear `inFlight` — the synthetic
 * mid-stream counter is by definition stale the moment the real frame
 * lands. The caller never has to drop `inFlight` manually.
 *
 * 2026: optional `reasoningTokens` / `cachedPromptTokens` /
 * `cacheCreationTokens` are folded with the same Math.max / sum
 * semantics as the primary fields. Missing on the `next` side means
 * the wire didn't report the breakdown — we preserve the prior peak
 * but skip the cumulative bump (the underlying primary token is
 * already counted in `promptTokens` / `completionTokens`).
 */
export function foldTokenUsage(
  prior: TokenUsageAggregate | undefined,
  next: TokenUsage,
  /**
   * Phase 12 (2026) — wall-clock timestamp of THIS usage event,
   * forwarded so the aggregate can advance `streamEndedAt`. Optional
   * for legacy callers (tests, etc.); when omitted the timestamp
   * slot is left untouched and tok/s simply doesn't refresh on this
   * fold.
   */
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

  // Note: `inFlight` is intentionally dropped — authoritative usage
  // supersedes any synthetic mid-stream estimate.
  const out: TokenUsageAggregate = {
    latest: next,
    peak,
    cumulative,
    samples: prior.samples + 1
  };
  // Phase 12 (2026): preserve the prior stream-start anchor (so a
  // multi-turn run reports run-level throughput, not last-turn-only),
  // and advance `streamEndedAt` to this usage event's timestamp.
  if (typeof prior.streamStartedAt === 'number') {
    out.streamStartedAt = prior.streamStartedAt;
  }
  if (typeof ts === 'number') out.streamEndedAt = ts;
  else if (typeof prior.streamEndedAt === 'number') out.streamEndedAt = prior.streamEndedAt;
  return out;
}

/**
 * Phase 12 (2026) — stamp the run's `streamStartedAt` anchor on first
 * delta. Idempotent: if the field is already set, returns `prior`
 * unchanged (object identity preserved so React selectors don't churn
 * on every subsequent delta). Creates an empty-shaped aggregate when
 * called BEFORE any authoritative `token-usage` event lands, so the
 * tok/s pill can still anchor against the right start time the moment
 * usage starts flowing.
 */
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

/** Max of two optional non-negative integers; `undefined` when both are missing. */
function maxOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

/** Sum of two optional non-negative integers; `undefined` when both are missing. */
function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

/**
 * Updates the `inFlight` slot on an aggregate. Mid-stream synthetic
 * counter (Phase 3): the orchestrator never reports these — they're
 * computed in the renderer from streamed `agent-text-delta` /
 * `agent-reasoning-delta` events tokenized locally. `latest` and the
 * peak/cumulative aggregates are untouched.
 *
 * Pass `undefined` for `next` to clear the slot (e.g. on `agent-text-end`,
 * abort, or run termination).
 */
export function setInFlightUsage(
  prior: TokenUsageAggregate | undefined,
  next: TokenUsage | undefined
): TokenUsageAggregate {
  if (!prior) {
    // No prior aggregate yet — establish a zero base so the renderer
    // has a non-null `latest` to read alongside the in-flight estimate.
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
