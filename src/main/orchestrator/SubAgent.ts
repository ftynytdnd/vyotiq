/**
 * SubAgent — one ephemeral worker, single task, isolated context. It is a
 * REAL parallel fetch() call to the same provider with a fresh message array.
 *
 * The sub-agent's own tool-loop is implemented here. It runs until the model
 * emits a `<result>…</result>` envelope or the iteration cap is hit.
 */

import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatPermissions,
  TimelineEvent,
  TokenUsage
} from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { streamChat } from '../providers/chatClient.js';
import { toolSchemasFor } from '../tools/registry.js';
import { validateSubagentToolset } from '../tools/policy/index.js';
import { buildSubagentSystemPrompt } from '../harness/harnessLoader.js';
import { buildHostEnvironmentXml } from './loop/buildHostEnvironment.js';
import { inlineFiles, type InlineFileCache } from './contextManager.js';
import { backoff } from './retry.js';
import { isAbortError } from './abortSignal.js';
import {
  MAX_SELF_CORRECTION_ATTEMPTS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_WRAPUP_ITER
} from '@shared/constants.js';
import { consumeChatStream } from './loop/consumeChatStream.js';
import { lockToolCallIds } from './loop/lockToolCallIds.js';
import { handleToolCalls } from './loop/handleToolCalls.js';
import { sanitizeToolCallPairing } from './loop/sanitizeToolPairing.js';
import { seedCachedRead } from './toolResultCache.js';
import { inferResultStatus } from '@shared/text/resultPatterns.js';
import {
  buildSubagentRunStateXml,
  type SubagentLastAction
} from './loop/buildSubagentRunState.js';
import { emitRunStatus } from './loop/emitRunStatus.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/subAgent');

export interface SubAgentSpec {
  id: string;
  task: string;
  files: string[];
  /** Restricted toolset. Defaults to read-only. */
  tools?: string[];
  /**
   * Recent mutations the orchestrator has performed in the SAME run
   * before this sub-agent spawned. Surfaced to the worker as a
   * `<recent_mutations>` block so it can avoid reading paths that no
   * longer exist (or have been renamed) — the most common failure
   * mode visible in the May 16 capture, where D3 tried to read
   * `frontend/src/index.css` after C2 had moved it to
   * `frontend/src/styles/index.css`. Optional; absent means the
   * worker sees no mutation block.
   */
  recentMutations?: ReadonlyArray<{
    kind: 'create' | 'modify' | 'delete';
    filePath: string;
    additions: number;
    deletions: number;
  }>;
}

export interface SubAgentRun {
  id: string;
  task: string;
  output: string;
  toolResults: ToolResult[];
  status: 'success' | 'partial' | 'failed' | 'aborted' | 'malformed';
  error?: string;
}

export interface SubAgentDeps {
  selection: ModelSelection;
  /**
   * Provider display name resolved by the orchestrator at run start.
   * Surfaced into this worker's `Connecting to <name>…` status label
   * instead of the raw `selection.providerId` UUID. Optional — when
   * omitted, the label falls back to `selection.providerId` so the
   * worker still produces a stable string.
   */
  providerName?: string;
  workspacePath: string;
  /** Workspace id (registry id) — required for checkpoint snapshots. */
  workspaceId: string;
  /** Run id (orchestrator-assigned). */
  runId: string;
  /** Conversation id that owns the run. */
  conversationId: string;
  permissions: ChatPermissions;
  /** Strict-approvals flag for this run's workspace. */
  strictApprovals: boolean;
  signal: AbortSignal;
  /**
   * Streaming callback fired *before* a tool executes. Lets the UI render a
   * pending step row with full args (so users see `read core/agent.py`
   * instead of a generic `read …` placeholder). Paired with `onToolResult`
   * by `ToolCall.id`.
   */
  onToolCall?: (call: ToolCall, subagentId: string) => void;
  /**
   * Streaming callback so the UI can mirror tool results in real time.
   * Receives the originating sub-agent id so timeline events can be
   * strictly attributed under concurrent execution.
   */
  onToolResult?: (result: ToolResult, subagentId: string) => void;
  /**
   * Fired after a successful `edit` tool result that has structured
   * file-edit metadata. Lets the renderer surface a dedicated FileEditRow
   * inside the owning sub-agent's trace.
   */
  onFileEdit?: (
    info: {
      filePath: string;
      additions: number;
      deletions: number;
      created: boolean;
      entryId?: string;
    },
    subagentId: string
  ) => void;
  /**
   * Fired once per sub-agent iteration when the provider reports usage
   * via `stream_options.include_usage`. Attribution is strict: the
   * second argument is the owning sub-agent's id, identical to what
   * `onToolCall` / `onToolResult` carry. Never fires for providers
   * that drop the flag silently.
   */
  onTokenUsage?: (usage: TokenUsage, subagentId: string) => void;
  /**
   * Per-sub-agent live status events. Mirrors the orchestrator's
   * `run-status` stream but scoped to one worker — `connecting`,
   * `awaiting-response`, `running-tool`, `retrying`. The renderer
   * routes any event whose `detail.subagentId` matches the worker's
   * id into the matching sub-agent row, so multiple parallel workers
   * each get their own breathing status line instead of fighting over
   * the orchestrator-level `LiveStatusRow`.
   *
   * The event itself already carries `subagentId` inside `detail`, but
   * we also pass it as the second argument so `SubAgentPool` and
   * `handleDelegates` can attribute the callback under concurrent
   * execution without re-parsing the payload.
   */
  onRunStatus?: (event: TimelineEvent, subagentId: string) => void;
  /**
   * Passthrough for persistent timeline events that `handleToolCalls`
   * / `runToolByName` emit but aren't covered by the streaming hooks
   * above — e.g. `checkpoint-entry`, `checkpoint-bash-mutation`,
   * sub-agent re-delegation `phase` rows. Without this, those events
   * never reach IPC/JSONL even though the pending panel still updates
   * via checkpoint `broadcast()`.
   */
  onTimelineEvent?: (event: TimelineEvent, subagentId: string) => void;
  /**
   * Streaming worker text + reasoning hooks. Lift the same delta
   * surface the orchestrator's `handleAssistantTurn` already emits,
   * but scoped to a single worker so the matching `SubAgentTrace`
   * card can render live output (instead of going dark until the
   * worker emits its `<result>` envelope). Each iteration mints a
   * fresh `assistantMsgId` (UUIDv4) so every iteration's stream is
   * an independent accumulator on the renderer side. Audit fix §1.1.
   *
   * `assistantMsgId` is the per-iteration handle; `subagentId` is the
   * worker handle and is identical across iterations of the same
   * worker. The renderer pairs the two when keying state.
   */
  onTextDelta?: (delta: string, assistantMsgId: string, subagentId: string) => void;
  onTextEnd?: (assistantMsgId: string, subagentId: string) => void;
  onTextAborted?: (assistantMsgId: string, subagentId: string) => void;
  onReasoningDelta?: (delta: string, assistantMsgId: string, subagentId: string) => void;
  /**
   * Phase 8 (2026): the optional `signature` arg carries the Anthropic
   * thinking-block signature accumulated during the closing reasoning
   * stream. Forwarded into the `agent-reasoning-end` timeline event so
   * the JSONL transcript can replay it onto the matching assistant
   * `ChatMessage.reasoning_signature`. `undefined` for non-Anthropic
   * dialects.
   */
  onReasoningEnd?: (assistantMsgId: string, subagentId: string, signature?: string) => void;
  /**
   * Streaming partial-args preview for an in-flight tool call inside
   * this worker. Mirrors the orchestrator's surface (see
   * `handleAssistantTurn`'s `onToolCallArgsDelta` hook); the runner
   * funnels these into a `tool-call-args-delta` timeline event tagged
   * with the worker's `subagentId` so the renderer can paint a live
   * preview inside the matching `SubAgentTrace`. Ephemeral telemetry —
   * never persisted.
   */
  onToolCallArgsDelta?: (snapshot: {
    index: number;
    id: string | undefined;
    name: string | undefined;
    argsBuf: string;
  }, subagentId: string) => void;
  /**
   * Optional round-scoped file-inlining cache. Threaded in by
   * `runSubAgentPool` so N parallel workers in the same delegation
   * round reading the same file cause exactly 1 disk read. Omitting
   * it (direct callers, tests) restores the legacy per-worker read
   * shape — semantics-preserving fallback. Audit fix A2.
   */
  inlineCache?: InlineFileCache;
}

export async function runSubAgent(spec: SubAgentSpec, deps: SubAgentDeps): Promise<SubAgentRun> {
  const startedAt = Date.now();
  const allowed = validateSubagentToolset(spec.tools);
  log.info('sub-agent starting', {
    id: spec.id,
    task: spec.task.slice(0, 120),
    files: spec.files.length,
    tools: allowed,
    modelId: deps.selection.modelId
  });

  // Audit fix 2026-08-P2-1 / 13-P2-1: thread the run's abort signal
  // through so a multi-file delegate spec stops paying FS cost the
  // moment the user (or the orchestrator) aborts the round.
  const filesBlock = await inlineFiles(
    deps.workspacePath,
    spec.files,
    deps.inlineCache,
    deps.signal
  );

  // Audit fix A4: pre-seed this worker's read-cache with a synthetic
  // hit for every file we just inlined. The first `read({ path })`
  // the worker issues on an inlined file will short-circuit through
  // `lookupCachedResult` with a host-authored explanation instead
  // of paying the FS round-trip + a full provider iteration. The
  // harness already tells workers not to re-read inlined files (see
  // `04-subagent-prompt.md` "Iteration discipline") but soft rules
  // degrade under load — visible in screenshot 1 where a worker
  // emitted `Read core/state.py, core/types.py` despite both being
  // inlined. This makes the rule structural.
  //
  // Errors from `seedCachedRead` are swallowed so a malformed entry
  // can never prevent the worker from starting; the seed is a
  // perf-only optimization and the legacy non-seeded path still
  // works.
  for (const rel of spec.files) {
    try {
      seedCachedRead(deps.signal, spec.id, rel);
    } catch (err) {
      log.debug('seedCachedRead failed', { rel, id: spec.id, err });
    }
  }

  // Helper: emit a `run-status` event tagged with this sub-agent's id
  // so the renderer can route it into the matching sub-agent trace
  // card instead of the orchestrator-level `LiveStatusRow`.
  // Adapts the shared `emitRunStatus` helper by routing through the
  // worker-scoped `onRunStatus` callback rather than a generic emit
  // sink (the sub-agent has no direct access to the run's emitter).
  const emitSubagentStatus = (
    phase: Parameters<typeof emitRunStatus>[1],
    label: string,
    extra?: Parameters<typeof emitRunStatus>[3]
  ): void => {
    if (!deps.onRunStatus) return;
    emitRunStatus(
      (event) => deps.onRunStatus?.(event, spec.id),
      phase,
      label,
      // Always tag the event with `subagentId` so the renderer can
      // attribute it under concurrent execution. Caller-supplied
      // detail wins for any other field.
      { subagentId: spec.id, ...(extra ?? {}) }
    );
  };

  // Recent-mutations block. Surfaced BEFORE `<files>` so the worker
  // sees the rename/delete signal before scanning the inlined file
  // contents. Soft hint only — the worker is free to ignore it, but
  // every `read` against a deleted path is a wasted iteration. We
  // cap the rendered list at 50 entries so a long-running run doesn't
  // blow out the prompt; the model already has the cumulative file
  // history through its own prior tool results.
  const recentMutationsBlock =
    spec.recentMutations && spec.recentMutations.length > 0
      ? `<recent_mutations>\n` +
      spec.recentMutations
        .slice(0, 50)
        .map((m) => `${m.kind}: ${m.filePath} (+${m.additions} / -${m.deletions})`)
        .join('\n') +
      `\n</recent_mutations>\n\n`
      : '';

  // The user message is now PURELY the file payload + recent-mutations
  // hint. The task text itself lives in the system prompt's `<task>`
  // block (see `buildSubagentSystemPrompt`). Repeating it here was the
  // original duplication source and a small but real attack surface:
  // the model could be tempted to read the user-message version as
  // overriding the system block. One source of truth, escaped, in the
  // instruction plane.
  //
  // Result-envelope rule moved out of the data plane (review finding
  // M10). The bundled `04-subagent-prompt.md` already enforces "Your
  // LAST action MUST be emitting one `<result>…</result>` envelope"
  // in the system-instructions block, AND the host wires
  // `tool_choice: 'none'` on the wrap-up turn (`SUBAGENT_WRAPUP_ITER`)
  // so the rule is enforced at the wire level. Restating it in the
  // user message duplicated the contract across the
  // instruction/data boundary — Prime Directives §6 wants
  // instructions to live in EXACTLY one place. The system prompt
  // remains authoritative; the user message is now pure data.
  const userMessage =
    recentMutationsBlock +
    (filesBlock ? `<files>\n${filesBlock}\n</files>` : '');

  const messages: ChatMessage[] = [
    // Placeholder system message — rebuilt in-place each iteration so
    // the sub-agent's `<run_state>` envelope reflects the live counter
    // values. Same pattern as `runLoop.ts`.
    { role: 'system', content: '' },
    { role: 'user', content: userMessage }
  ];

  const allResults: ToolResult[] = [];

  let attempt = 0;
  let lastAction: SubagentLastAction = 'none';
  // One-shot recovery flag for the "model emitted final prose without
  // a `<result>…</result>` envelope" pathology (production failure
  // shape: conversation `35caa9dc-…jsonl` sub-agent D2). The wrap-up
  // turn at `SUBAGENT_WRAPUP_ITER` enforces `tool_choice: 'none'` for
  // slow workers — but a fast worker that finishes on iteration 1
  // with a missing envelope (e.g. emits the work narration in plain
  // prose, having already run its `edit` tool) had no recovery path
  // and got reported as `'malformed'` even though the underlying
  // edit had landed. We give the worker exactly ONE re-prompt to
  // wrap its already-emitted content in `<result>` before accepting
  // the malformed terminus. Capped at one re-prompt per worker so
  // we cannot ping-pong against a model that ignores the nudge.
  let textNoResultNudged = false;

  for (let iter = 0; iter < SUBAGENT_MAX_ITERATIONS; iter++) {
    if (deps.signal.aborted) {
      return { id: spec.id, task: spec.task, output: '', toolResults: allResults, status: 'aborted' };
    }

    // Wrap-up turn: at iteration `SUBAGENT_WRAPUP_ITER` we flip
    // `tool_choice` to `'none'` so the provider is physically forced to
    // emit prose instead of more tool calls. Mirrors the harness
    // contract in `04-subagent-prompt.md` ("Your LAST action MUST be a
    // <result> envelope, not another tool call") and elevates that
    // soft instruction to a wire-level guarantee. The model still sees
    // `wrap_up_pending: true` in `<run_state>` so the constraint is
    // visible in the prompt as well as enforced in the request body.
    const isWrapUpTurn = iter === SUBAGENT_WRAPUP_ITER;

    // Rebuild the system prompt with a fresh `<run_state>` envelope
    // and a fresh `<host_environment>` snapshot. The static portion
    // (directives + harness body + tool catalogue + limits + task) is
    // identical across iterations; only the trailing dynamic blocks
    // change. See `buildSubagentSystemPrompt` for the layered shape.
    //
    // Host environment is built per-iteration (not cached) because
    // real-time is the whole point — same rationale as the
    // orchestrator's runLoop.ts. Cost is microsecond-cheap.
    const runStateXml = buildSubagentRunStateXml({
      iteration: iter,
      allowedTools: allowed,
      lastAction,
      consecutiveErrors: attempt,
      wrapUpPending: isWrapUpTurn
    });
    const hostEnvironmentXml = buildHostEnvironmentXml();
    messages[0] = {
      role: 'system',
      content: buildSubagentSystemPrompt({
        task: spec.task,
        allowedTools: allowed,
        runState: runStateXml,
        hostEnvironment: hostEnvironmentXml
      })
    };

    let assistantText = '';
    let reasoningText = '';
    // Phase 8 (2026): Anthropic thinking signature for the closing
    // turn — empty string when absent (non-Anthropic dialect or no
    // thinking block emitted). The variable lives at iteration scope
    // because the post-stream tool-call/text branches both consume it
    // when minting the assistant `ChatMessage`.
    let reasoningSignature = '';
    // Phase 9 (2026): widened so each partial can carry an optional
    // `thoughtSignature` from the Gemini transport. Anthropic doesn't
    // populate the field; OpenAI-compat providers don't either.
    let partialToolCalls: Array<{
      id?: string;
      name?: string;
      argumentsBuf: string;
      thoughtSignature?: string;
    }> = [];
    let lastError: unknown;

    // Per-iteration assistant message id. Drives the renderer's
    // text + reasoning accumulator keys for THIS iteration only —
    // each new iteration starts a fresh accumulator so multi-turn
    // workers render as a sequence of streamed bodies (not one
    // ever-growing blob). Audit fix §1.1.
    const assistantMsgId = randomUUID();
    // Tracks whether at least one text or reasoning delta landed on
    // this iteration. Used to gate the closing `text-end` /
    // `reasoning-end` emissions so we don't fabricate a closer for
    // a stream the renderer never opened.
    let textOpened = false;
    let reasoningOpened = false;
    // `consumeChatStream` may emit `onReasoningEnd` mid-stream (when
    // reasoning transitions to text/tool_calls). If it already did,
    // the post-stream guard below must NOT re-fire — that would
    // double-close the renderer's reasoning panel and bloat the
    // "Thought for Ns" timer.
    let reasoningEndedDuringStream = false;

    // Live status — pre-stream phases. Two distinct waiting windows so
    // the renderer can label network latency and model-think time
    // differently inside the sub-agent's own status row. Mirrors the
    // orchestrator's `runLoop.ts:emitRunStatus` cadence.
    emitSubagentStatus(
      'connecting',
      `Connecting to ${deps.providerName ?? deps.selection.providerId}…`,
      {
        providerId: deps.selection.providerId,
        modelId: deps.selection.modelId,
        iteration: iter
      }
    );

    try {
      const stream = streamChat({
        providerId: deps.selection.providerId,
        model: deps.selection.modelId,
        // Same defensive sanitizer the orchestrator applies — any
        // orphan `assistant.tool_calls` from a previous iteration's
        // partial failure or aborted run is patched with a stub
        // response so strict providers don't 400 this request.
        messages: sanitizeToolCallPairing(messages),
        tools: toolSchemasFor(allowed),
        // Wrap-up turn forces prose. See `isWrapUpTurn` block above.
        toolChoice: isWrapUpTurn ? 'none' : 'auto',
        signal: deps.signal,
        onConnect: () => {
          emitSubagentStatus(
            'awaiting-response',
            `Awaiting first token from ${deps.selection.modelId}…`,
            {
              providerId: deps.selection.providerId,
              modelId: deps.selection.modelId,
              iteration: iter
            }
          );
        }
      });
      const consumed = await consumeChatStream(stream, {
        // Forward live deltas for this iteration through the deps
        // hooks. The first delta opens the renderer accumulator;
        // subsequent deltas append. Audit fix §1.1.
        ...(deps.onTextDelta
          ? {
            onTextDelta: (delta) => {
              textOpened = true;
              deps.onTextDelta?.(delta, assistantMsgId, spec.id);
            }
          }
          : {}),
        ...(deps.onReasoningDelta
          ? {
            onReasoningDelta: (delta) => {
              reasoningOpened = true;
              deps.onReasoningDelta?.(delta, assistantMsgId, spec.id);
            }
          }
          : {}),
        ...(deps.onReasoningEnd
          ? {
            onReasoningEnd: (signature) => {
              // Emit only if reasoning was actually opened on this
              // iteration. `consumeChatStream` already gates the hook
              // (see `maybeCloseReasoning`), so this is defensive.
              if (!reasoningOpened) return;
              reasoningEndedDuringStream = true;
              deps.onReasoningEnd?.(assistantMsgId, spec.id, signature);
            }
          }
          : {}),
        // Forward streaming partial-args snapshots into the worker's
        // owning runtime (see `SubAgentPool` for the matching
        // emission). The runtime decides whether to surface them as
        // `tool-call-args-delta` timeline events; the worker stays
        // ignorant of the IPC contract.
        ...(deps.onToolCallArgsDelta
          ? {
            onToolCallArgsDelta: (snapshot) => {
              deps.onToolCallArgsDelta?.(snapshot, spec.id);
            }
          }
          : {})
      });
      assistantText = consumed.assistantText;
      reasoningText = consumed.reasoningText;
      partialToolCalls = consumed.partialToolCalls;
      // Phase 8 (2026): hoist the Anthropic thinking signature to outer
      // scope so the post-stream tool-call / text branches can persist
      // it onto the assistant `ChatMessage`. Empty string falsy-check
      // below maps to the absent field.
      reasoningSignature = consumed.reasoningSignature ?? '';
      // Surface per-iteration token usage to the pool so the UI can
      // aggregate latest / peak / cumulative views per sub-agent. Fires
      // at most once per iteration; providers that ignore the
      // `include_usage` flag simply leave this undefined.
      if (consumed.usage) {
        deps.onTokenUsage?.(consumed.usage, spec.id);
      }
    } catch (err: unknown) {
      lastError = err;
    }

    if (lastError) {
      // Drop any partial in-flight worker text/reasoning so the
      // matching renderer accumulator doesn't keep the half-streamed
      // body around through a retry. Audit fix §1.1.
      //
      // The gate is `textOpened || reasoningOpened` to mirror
      // `runLoop.ts:499`'s `hadText || hadReasoning` check. The
      // renderer reducer's `agent-text-aborted` event drops BOTH
      // the text AND reasoning accumulators for the id, so a single
      // emit is sufficient — but it MUST fire when reasoning was the
      // only stream open (mid-reasoning provider error with no
      // text/tool_calls transition yet). Without this branch, the
      // per-iteration `reasoningTexts[assistantMsgId]` slot would
      // dangle in the renderer state because each retry mints a
      // fresh `assistantMsgId`.
      if (textOpened || (reasoningOpened && !reasoningEndedDuringStream)) {
        deps.onTextAborted?.(assistantMsgId, spec.id);
      }
      // Symmetry with `runLoop`: a user-initiated Stop (or run-scoped
      // signal firing for any reason) surfaces here as an AbortError
      // from `fetch`/the SSE reader. Previously this counted toward
      // `MAX_SELF_CORRECTION_ATTEMPTS`, and if abort landed on the
      // third strike the sub-agent was reported `status: 'failed'`
      // instead of the authoritative `'aborted'` — polluting the
      // delegation verdict and bumping the three-strike counter.
      // Detect the abort first and return the `'aborted'` shape the
      // top-of-loop check at line 141 already uses.
      if (isAbortError(lastError, deps.signal)) {
        return { id: spec.id, task: spec.task, output: '', toolResults: allResults, status: 'aborted' };
      }
      attempt += 1;
      if (attempt >= MAX_SELF_CORRECTION_ATTEMPTS) {
        const msg = lastError instanceof Error ? lastError.message : String(lastError);
        return {
          id: spec.id,
          task: spec.task,
          output: assistantText,
          toolResults: allResults,
          status: 'failed',
          error: msg
        };
      }
      emitSubagentStatus(
        'retrying',
        `Retrying provider call (${attempt}/${MAX_SELF_CORRECTION_ATTEMPTS})…`,
        {
          attempt,
          maxAttempts: MAX_SELF_CORRECTION_ATTEMPTS,
          providerId: deps.selection.providerId,
          modelId: deps.selection.modelId
        }
      );
      try {
        await backoff(attempt, { signal: deps.signal });
      } catch {
        return { id: spec.id, task: spec.task, output: '', toolResults: allResults, status: 'aborted' };
      }
      lastAction = 'retry';
      continue;
    }

    // The provider call succeeded — reset the consecutive-error counter
    // so transient flakes earlier in this sub-agent's lifetime don't
    // burn down the three-strike budget on a LATER (unrelated) flake.
    // Mirrors `runLoop.ts` which does `consecutiveErrors = 0` on every
    // successful iteration. Previously `attempt` accumulated across all
    // 16 iterations, so `[err, ok, ok, …, err, ok, err]` would terminate
    // the sub-agent as `failed` even though 13 iterations succeeded.
    attempt = 0;

    // Close the worker streaming accumulators for THIS iteration so
    // the renderer flips the matching body from "streaming" to
    // "settled" before any subsequent tool round (which would
    // otherwise visually overlap the previous text). Audit fix §1.1.
    //
    // `consumeChatStream` already emits `onReasoningEnd` mid-stream the
    // moment reasoning transitions to text/tool_calls — that hook
    // covers the common case. The fallback below only fires when the
    // turn was pure reasoning with no follow-up content (rare).
    if (textOpened) deps.onTextEnd?.(assistantMsgId, spec.id);
    if (reasoningOpened && !reasoningEndedDuringStream) {
      // Pure-reasoning fallback path: the stream ended without a
      // content/tool-call follow-up so `consumeChatStream` never fired
      // its mid-stream `onReasoningEnd`. Forward the signature from the
      // result so a thinking-only Anthropic turn still round-trips its
      // signature through the timeline.
      deps.onReasoningEnd?.(
        assistantMsgId,
        spec.id,
        reasoningSignature.length > 0 ? reasoningSignature : undefined
      );
    }

    // If there are tool calls, execute them and loop.
    const finishedCalls = partialToolCalls.filter((tc) => tc?.name);
    if (finishedCalls.length > 0) {
      // Mint a stable id per tool call BEFORE pushing the assistant
      // message. See `lockToolCallIds` for the full id-flow contract.
      lockToolCallIds(finishedCalls);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        // Canonical OpenAI shape: null content when only tool_calls are emitted.
        content: assistantText.length === 0 ? null : assistantText,
        ...(reasoningText.length > 0 ? { reasoning_content: reasoningText } : {}),
        // Phase 8 (2026): persist the Anthropic thinking signature on
        // the assistant message so the next request includes the
        // `{type:'thinking', thinking, signature}` block unchanged.
        // Required for plan continuity on Claude thinking-capable
        // models. Other dialects leave `reasoningSignature` empty and
        // the field stays absent.
        ...(reasoningSignature.length > 0
          ? { reasoning_signature: reasoningSignature }
          : {}),
        tool_calls: finishedCalls.map((tc) => ({
          id: tc.id!,
          type: 'function' as const,
          function: { name: tc.name ?? 'unknown', arguments: tc.argumentsBuf || '{}' },
          ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
            ? { thoughtSignature: tc.thoughtSignature }
            : {})
        }))
      };
      messages.push(assistantMsg);

      // Delegate the per-call work to the shared `handleToolCalls`. The
      // emit adapter translates the timeline events that helper produces
      // back into the per-deps callbacks the sub-agent pool consumes;
      // the result list is captured by snapshotting `tool-result`
      // events. This collapses what used to be a near-duplicate copy
      // of the orchestrator's tool loop.
      const subagentEmit = (event: TimelineEvent) => {
        if (event.kind === 'tool-call' && event.subagentId === spec.id) {
          deps.onToolCall?.(event.call, spec.id);
          return;
        }
        if (event.kind === 'tool-result' && event.subagentId === spec.id) {
          allResults.push(event.result);
          deps.onToolResult?.(event.result, spec.id);
          return;
        }
        if (event.kind === 'file-edit' && event.subagentId === spec.id) {
          // The shared helper does not have access to the `created`
          // boolean (it would require ToolData inside the event); pull
          // it off the matching tool-result if available.
          const matchingResult = allResults.find(
            (r) => r.name === 'edit' && r.data?.tool === 'edit' && r.data.filePath === event.filePath
          );
          const created =
            matchingResult?.data?.tool === 'edit' ? matchingResult.data.created : false;
          deps.onFileEdit?.(
            {
              filePath: event.filePath,
              additions: event.additions,
              deletions: event.deletions,
              created,
              ...(event.entryId ? { entryId: event.entryId } : {})
            },
            spec.id
          );
          return;
        }
        if (event.kind === 'run-status' && event.detail?.subagentId === spec.id) {
          // `handleToolCalls` emits per-tool `running-tool` status with
          // `detail.subagentId` set for worker-scoped rounds.
          deps.onRunStatus?.(event, spec.id);
          return;
        }
        deps.onTimelineEvent?.(event, spec.id);
      };

      const summary = await handleToolCalls(finishedCalls, messages, subagentEmit, {
        workspacePath: deps.workspacePath,
        workspaceId: deps.workspaceId,
        runId: deps.runId,
        conversationId: deps.conversationId,
        permissions: deps.permissions,
        strictApprovals: deps.strictApprovals,
        signal: deps.signal,
        subagentId: spec.id,
        allowlist: allowed
      });
      // Translate the helper's structural summary into the run-state
      // `lastAction` slot the next iteration will surface. Allowlist-
      // refused calls produce `attempted === 0` even when the round
      // had finished calls — surface that distinct state separately so
      // the model sees "your tool was refused" instead of conflating
      // it with a clean tool round.
      if (summary.attempted === 0 && finishedCalls.length > 0) {
        lastAction = 'refused-by-allowlist';
      } else if (summary.attempted > 0 && summary.failed === summary.attempted) {
        lastAction = 'tool-round:failed';
      } else {
        lastAction = 'tool-round:ok';
      }
      continue; // loop and let the model decide next step
    }

    // No tool calls — model has emitted text. Push it and finalize.
    messages.push({
      role: 'assistant',
      content: assistantText,
      ...(reasoningText.length > 0 ? { reasoning_content: reasoningText } : {}),
      // Phase 8 (2026): same Anthropic signature persistence rule as
      // the tool-call branch above. The terminal text-only turn still
      // wants the thinking signature attached so a follow-up turn (a
      // user reply on the same conversation) round-trips it.
      ...(reasoningSignature.length > 0
        ? { reasoning_signature: reasoningSignature }
        : {})
    });

    const status = inferResultStatus(assistantText);

    // Missing-envelope recovery (one-shot per worker). The harness
    // mandates that the worker's LAST action MUST be a
    // `<result>…</result>` envelope. The wrap-up turn enforces it at
    // the wire (`tool_choice: 'none'`) for slow workers, but a fast
    // worker that finishes on iter 1 with substantive prose and a
    // landed `edit` would otherwise be marked `'malformed'`
    // immediately — even though one short re-prompt is enough to fix
    // the wrap. Re-prompt exactly once per worker; subsequent
    // missing-envelope turns accept the malformed terminus and exit.
    //
    // Special-cases the D3 production shape too: a worker that
    // emitted only `<delegate>` directives (sub-agents cannot
    // delegate) lands here with substantive text, no `<result>`, no
    // tool calls, and no edits. The recovery message tells the
    // worker that delegation is forbidden AND that it must wrap its
    // intent in `<result>`.
    //
    // T0-2 — hopeless-shot short-circuit. When the model produced
    // zero text AND zero tool results, there is genuinely nothing
    // to wrap in a `<result>` envelope. The recovery message would
    // just consume one of the worker's iterations to ask for a
    // wrap-up of empty content; the next iteration would loop back
    // here with the same shape. Mirrors the orchestrator-side
    // hopeless-reasoning short-circuit in `handleNoToolNoDelegate.ts`
    // and saves a wasted provider call.
    const hasNothingToWrap =
      assistantText.trim().length === 0 && allResults.length === 0;
    if (status === 'malformed' && hasNothingToWrap) {
      log.warn('sub-agent emitted empty malformed turn; skipping recovery', {
        id: spec.id,
        iter
      });
      return {
        id: spec.id,
        task: spec.task,
        output: assistantText,
        toolResults: allResults,
        status: 'failed',
        error:
          'Sub-agent finished without producing any output (no text, no tool ' +
          'calls, no result envelope) — nothing to verify; treating the round ' +
          'as failed.'
      };
    }
    if (status === 'malformed' && !textNoResultNudged && iter < SUBAGENT_MAX_ITERATIONS - 1) {
      textNoResultNudged = true;
      lastAction = 'text-no-result';
      log.info('sub-agent missing-envelope recovery prompt', {
        id: spec.id,
        iter,
        cleanTextLen: assistantText.length,
        toolResults: allResults.length
      });
      messages.push({
        role: 'user',
        content:
          'Your last turn ended without a `<result>…</result>` envelope. The host treats ' +
          'an envelope-less worker output as `malformed` and reports the round as ' +
          'failed even when the underlying work succeeded. Re-emit your final answer ' +
          'wrapped in the canonical envelope:\n\n' +
          '```\n' +
          '<result>\n' +
          '<status>success|partial|failed</status>\n' +
          '<summary>One sentence: what you did or attempted.</summary>\n' +
          '<details>\n' +
          '- Specific finding or change.\n' +
          '</details>\n' +
          '<artifacts>\n' +
          '- Path or symbol you produced/modified.\n' +
          '</artifacts>\n' +
          '</result>\n' +
          '```\n\n' +
          'Sub-agents cannot emit `<delegate ... />` directives — only the orchestrator ' +
          'can. If your previous turn contained delegation directives, replace them with ' +
          'the actual work or report `<status>failed</status>` with the reason.'
      });
      continue;
    }

    log.info('sub-agent finished', {
      id: spec.id,
      iter,
      status,
      toolResults: allResults.length,
      nudged: textNoResultNudged,
      ms: Date.now() - startedAt
    });
    const error =
      status === 'malformed'
        ? 'Sub-agent finished without a structured result envelope — ' +
        'the orchestrator cannot verify success.'
        : undefined;
    return {
      id: spec.id,
      task: spec.task,
      output: assistantText,
      toolResults: allResults,
      status,
      ...(error ? { error } : {})
    };
  }

  log.warn('sub-agent iteration cap reached', {
    id: spec.id,
    cap: SUBAGENT_MAX_ITERATIONS,
    ms: Date.now() - startedAt
  });
  return {
    id: spec.id,
    task: spec.task,
    output: '',
    toolResults: allResults,
    status: 'failed',
    error: `iteration cap reached (${SUBAGENT_MAX_ITERATIONS} turns)`
  };
}

