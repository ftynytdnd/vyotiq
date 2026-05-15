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
    info: { filePath: string; additions: number; deletions: number; created: boolean },
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
  onReasoningEnd?: (assistantMsgId: string, subagentId: string) => void;
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

  const filesBlock = await inlineFiles(deps.workspacePath, spec.files, deps.inlineCache);

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

  // The user message is now PURELY the file payload + closing nudge.
  // The task text itself lives in the system prompt's `<task>` block
  // (see `buildSubagentSystemPrompt`). Repeating it here was the
  // original duplication source and a small but real attack surface:
  // the model could be tempted to read the user-message version as
  // overriding the system block. One source of truth, escaped, in the
  // instruction plane.
  const userMessage =
    (filesBlock ? `<files>\n${filesBlock}\n</files>\n\n` : '') +
    `When you are done, output exactly one <result>…</result> envelope.`;

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

    // Rebuild the system prompt with a fresh `<run_state>` envelope.
    // The static portion (directives + harness body + tool catalogue +
    // limits + task) is identical across iterations; only the trailing
    // run-state block changes. See `buildSubagentSystemPrompt` for the
    // layered shape.
    const runStateXml = buildSubagentRunStateXml({
      iteration: iter,
      allowedTools: allowed,
      lastAction,
      consecutiveErrors: attempt,
      wrapUpPending: isWrapUpTurn
    });
    messages[0] = {
      role: 'system',
      content: buildSubagentSystemPrompt({
        task: spec.task,
        allowedTools: allowed,
        runState: runStateXml
      })
    };

    let assistantText = '';
    let reasoningText = '';
    let partialToolCalls: Array<{ id?: string; name?: string; argumentsBuf: string }> = [];
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
            onReasoningEnd: () => {
              // Emit only if reasoning was actually opened on this
              // iteration. `consumeChatStream` already gates the hook
              // (see `maybeCloseReasoning`), so this is defensive.
              if (!reasoningOpened) return;
              reasoningEndedDuringStream = true;
              deps.onReasoningEnd?.(assistantMsgId, spec.id);
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
      deps.onReasoningEnd?.(assistantMsgId, spec.id);
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
        tool_calls: finishedCalls.map((tc) => ({
          id: tc.id!,
          type: 'function' as const,
          function: { name: tc.name ?? 'unknown', arguments: tc.argumentsBuf || '{}' }
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
        } else if (event.kind === 'tool-result' && event.subagentId === spec.id) {
          allResults.push(event.result);
          deps.onToolResult?.(event.result, spec.id);
        } else if (event.kind === 'file-edit' && event.subagentId === spec.id) {
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
              created
            },
            spec.id
          );
        } else if (event.kind === 'run-status' && event.detail?.subagentId === spec.id) {
          // `handleToolCalls` may emit per-tool `running-tool` status
          // when a `subagentId` is present (it currently scopes that
          // emission to orchestrator-level rounds — see the helper —
          // but routing the kind here keeps the contract symmetric so
          // future surfaces ride through unchanged).
          deps.onRunStatus?.(event, spec.id);
        }
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
      ...(reasoningText.length > 0 ? { reasoning_content: reasoningText } : {})
    });

    const status = inferResultStatus(assistantText);
    log.info('sub-agent finished', {
      id: spec.id,
      iter,
      status,
      toolResults: allResults.length,
      ms: Date.now() - startedAt
    });
    return {
      id: spec.id,
      task: spec.task,
      output: assistantText,
      toolResults: allResults,
      status
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

