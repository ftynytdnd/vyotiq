/**
 * Shared types for the renderer-side timeline reducer. Kept in a separate
 * file so both the reducer implementation and the stores can import them
 * without creating a cycle.
 */

import type { TimelineEvent, TokenUsage } from '@shared/types/chat.js';
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
 * - `done` / `failed` / `aborted`: terminal states reported by the host.
 */
type SubAgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'aborted';

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
 */
export interface TokenUsageAggregate {
  latest: TokenUsage;
  peak: TokenUsage;
  cumulative: TokenUsage;
  /** Count of usage events folded in. Useful for empty-state checks. */
  samples: number;
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
}

export const INITIAL_TIMELINE_STATE: TimelineState = {
  events: [],
  assistantTexts: {},
  reasoningTexts: {},
  subagents: {},
  partialToolCallArgs: {},
  settledCallIds: {},
  runIdToFileEditCount: {}
};

/**
 * Folds a single `TokenUsage` report into a running aggregate.
 * Pure; returns a new aggregate when the prior is undefined or when
 * any field changes.
 */
export function foldTokenUsage(
  prior: TokenUsageAggregate | undefined,
  next: TokenUsage
): TokenUsageAggregate {
  if (!prior) {
    return {
      latest: next,
      peak: next,
      cumulative: next,
      samples: 1
    };
  }
  const peak: TokenUsage = {
    promptTokens: Math.max(prior.peak.promptTokens, next.promptTokens),
    completionTokens: Math.max(prior.peak.completionTokens, next.completionTokens),
    totalTokens: Math.max(prior.peak.totalTokens, next.totalTokens)
  };
  const cumulative: TokenUsage = {
    promptTokens: prior.cumulative.promptTokens + next.promptTokens,
    completionTokens: prior.cumulative.completionTokens + next.completionTokens,
    totalTokens: prior.cumulative.totalTokens + next.totalTokens
  };
  return {
    latest: next,
    peak,
    cumulative,
    samples: prior.samples + 1
  };
}
