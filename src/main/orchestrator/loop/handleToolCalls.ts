/**
 * Executes a batch of tool calls produced by ANY agent loop (orchestrator
 * or sub-agent) and emits the matching timeline events. The orchestrator's
 * catalogue is restricted by `tools/policy/orchestratorTools.ts` (only
 * `ls`, `memory`, and `recall` reach here at orchestrator level); sub-agents
 * pass a per-task `allowlist` to refuse anything outside their granted
 * toolset. Both call sites used to maintain near-duplicate copies of this
 * loop — the duplication is now collapsed here so the id-locking,
 * timeline emission, allowlist enforcement, and message-history shape
 * stay in lockstep.
 *
 * Side-effects per call (in order):
 *   1. (sub-agent only) reject early with a tool message if the call's
 *      name is outside `allowlist`.
 *   2. Emit `tool-call` to the timeline (with `subagentId` when set).
 *   3. Invoke the tool via the runner.
 *   4. Emit `tool-result` (with `subagentId` when set).
 *   5. Surface a `file-edit` card if the call was a successful `edit`.
 *   6. Push the result back onto the model's `messages` as `role:'tool'`.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatPermissions, TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import { runToolByName } from '../toolRunner.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/handleToolCalls');

function emitSyntheticToolFailure(
  tc: PartialToolCall,
  emit: (event: TimelineEvent) => void,
  messages: ChatMessage[],
  opts: HandleToolCallsOpts,
  output: string,
  error: string
): void {
  const callId = tc.id ?? randomUUID();
  if (!tc.id) tc.id = callId;
  const name = (tc.name ?? 'unknown') as ToolName;
  const syntheticResult = {
    id: callId,
    name,
    ok: false as const,
    output,
    error,
    durationMs: 0
  };
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result: syntheticResult,
    ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
  });
  messages.push({
    role: 'tool',
    tool_call_id: callId,
    name: tc.name ?? 'unknown',
    content: output
  });
}

/**
 * Coerce a streaming-tool-call's `argumentsBuf` into the
 * `Record<string, unknown>` shape the tool executor expects, OR
 * surface a structured parse error so the caller can short-circuit
 * dispatch (review finding M6).
 *
 * Three failure modes were silently collapsing to `{}` before this
 * helper existed, and the symptom (e.g. `read` failing with
 * "missing path") looked like a model error:
 *
 *   1. Empty buffer — the model emitted a tool call with no
 *      arguments at all. `JSON.parse('')` throws. We treat this
 *      as a VALID empty-args call (some tools accept zero args)
 *      and return `{}` with no error.
 *   2. Malformed JSON — a provider truncated mid-stream or a
 *      non-conformant compat backend forwarded an object as a
 *      string ("[object Object]"). `JSON.parse` throws. Surfaced
 *      as `parseError` so the caller short-circuits with a
 *      synthetic failure result instead of dispatching the tool
 *      with `{}` (which usually fails downstream with a generic
 *      "missing path" / "missing command" — wasting a model
 *      round-trip).
 *   3. Valid JSON but wrong shape — the buffer parses to `null`,
 *      a string, a number, or an array. Same short-circuit
 *      treatment as malformed JSON.
 *
 * The legacy fallback-to-`{}` behaviour for cases 2 and 3 dispatched
 * the tool, which then surfaced a confusing downstream error
 * ("missing path") and burned a turn. The short-circuit replaces
 * that with a precise "argument parse failed" message the model
 * can directly correct.
 */
interface ToolArgsParseResult {
  args: Record<string, unknown>;
  parseError?: string;
}
function parseToolArgs(name: string, buf: string): ToolArgsParseResult {
  if (!buf) return { args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn('tool arguments failed to JSON.parse', {
      tool: name,
      buf: buf.slice(0, 200),
      err: detail
    });
    return {
      args: {},
      parseError:
        `Tool argument JSON failed to parse: ${detail}. ` +
        'Re-issue the call with a well-formed JSON object for `arguments`.'
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const shape = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    log.warn('tool arguments parsed to non-record', {
      tool: name,
      buf: buf.slice(0, 200),
      shape
    });
    return {
      args: {},
      parseError:
        `Tool argument must be a JSON object, got ${shape}. ` +
        'Re-issue the call with a `{ "key": "value", … }` shape.'
    };
  }
  return { args: parsed as Record<string, unknown> };
}

export interface HandleToolCallsOpts {
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
   * When set, every emitted timeline event is tagged with this id so the
   * renderer can attribute the tool call to its owning sub-agent under
   * concurrent execution. When omitted the events are top-level
   * (orchestrator-attributed).
   */
  subagentId?: string;
  /**
   * When set, calls whose `name` is not in this allowlist are answered
   * with a synthetic `role:'tool'` failure message and skipped — no
   * tool execution, no timeline emission. Used by sub-agents to enforce
   * the per-task `tools=` slot from `<delegate />`.
   */
  allowlist?: readonly string[];
  /**
   * Phase 2 — notification hook fired the moment an authoritative
   * `tool-call` event is about to be emitted, so the run-level
   * diff streamer can drop its in-flight state for that callId.
   * No-op when omitted (matches the existing call sites that don't
   * use the streamer).
   *
   * `owner` is forwarded so the streamer can fold a still-pending
   * `pending:${owner}:${index}` surrogate `CallState` into the
   * real id if the provider transitioned `id` from `undefined`
   * mid-stream. Sub-agents pass their own `subagentId` here;
   * orchestrator-level rounds pass `'orc'`.
   */
  onToolCallSettled?: (callId: string, owner?: string, index?: number) => void;
}

/**
 * Per-round summary returned to the caller so it can implement the
 * harness's "Three-strike rule" at orchestrator level (audit §6.5).
 * Allowlist refusals are counted as `attempted: 0` because no actual
 * tool ever ran — they should not count toward the strike budget.
 */
export interface HandleToolCallsResult {
  /** Calls actually dispatched to a tool (excludes allowlist refusals). */
  attempted: number;
  /** Of `attempted`, how many produced a `result.ok === false`. */
  failed: number;
  /**
   * Number of refused `delegate` tool calls in this round. The
   * `<delegate />` directive is an XML construct in the assistant's
   * output channel — it is NEVER a callable tool. When the model
   * (orchestrator or sub-agent) tries to invoke it through the
   * function-calling channel, the allowlist refuses it. Counting
   * those attempts lets the orchestrator surface a `<run_state>`
   * hint so the model pivots back to the directive syntax instead
   * of repeatedly retrying the same refused call. Pure observability
   * — does not affect the allowlist refusal itself.
   */
  childRedelegations: number;
}

export async function handleToolCalls(
  finishedToolCalls: PartialToolCall[],
  messages: ChatMessage[],
  emit: (event: TimelineEvent) => void,
  opts: HandleToolCallsOpts
): Promise<HandleToolCallsResult> {
  const startedAt = Date.now();
  let attempted = 0;
  let failed = 0;
  let refused = 0;
  let childRedelegations = 0;
  let orchestratorDelegateRefusals = 0;
  for (let i = 0; i < finishedToolCalls.length; i++) {
    const tc = finishedToolCalls[i]!;
    // Honor `opts.signal.aborted` between tool calls so a supersede
    // (new `chat:send` on the same conversation) or explicit Stop
    // cannot leak a half-round's tool-result events into the
    // transcript AFTER the next run has already started reading it.
    // Without this guard, `chat.ipc.ts` would `drainAppendChain`
    // before launching the new run, but late `tool-result` emits
    // from this loop (still iterating) would land in the JSONL out
    // of order. Review finding H3.
    if (opts.signal.aborted) {
      log.debug('tool round aborted mid-iteration', {
        remaining: finishedToolCalls.length - i,
        subagentId: opts.subagentId
      });
      for (let j = i; j < finishedToolCalls.length; j++) {
        const rem = finishedToolCalls[j]!;
        refused += 1;
        emitSyntheticToolFailure(
          rem,
          emit,
          messages,
          opts,
          'Tool call aborted because the run was stopped or superseded.',
          'aborted'
        );
      }
      break;
    }
    if (!tc.name) {
      refused += 1;
      if (!tc.id) tc.id = randomUUID();
      emitSyntheticToolFailure(
        tc,
        emit,
        messages,
        opts,
        'Tool call missing a name — cannot execute.',
        'missing tool name'
      );
      continue;
    }
    // Defensive — runLoop guarantees `tc.id` is populated before this
    // function runs, but if a caller forgets, fall back to a fresh UUID
    // and IMMEDIATELY persist it on the partial so every downstream use
    // (assistant message, timeline events, tool message) reads the same
    // value.
    if (!tc.id) tc.id = randomUUID();
    const callId = tc.id;

    // Allowlist enforcement happens BEFORE the timeline tool-call
    // event so a refused call never produces a misleading
    // tool-call/tool-result pair in the UI. Applies to BOTH the
    // sub-agent path (per-task tools=) and the orchestrator path
    // (`ORCHESTRATOR_TOOLS` from `tools/policy/orchestratorTools.ts`),
    // which the orchestrator's `runLoop` now passes in explicitly so a
    // model that emits `edit` / `bash` / `delete` via function-calling
    // (despite those tools being absent from its schema) can't smuggle
    // a direct mutation through and bypass the delegate pattern.
    if (opts.allowlist && !opts.allowlist.includes(tc.name)) {
      refused += 1;
      const isDelegateAttempt = tc.name === 'delegate';
      if (isDelegateAttempt) {
        childRedelegations += 1;
        if (opts.subagentId === undefined) {
          orchestratorDelegateRefusals += 1;
        } else {
          // Sub-agent re-delegation attempts are rare — surface each
          // one individually so the trace stays legible.
          emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label: 'Sub-agent attempted re-delegation (refused — use <result>)'
          });
        }
      }
      log.warn('allowlist refusal', {
        tool: tc.name,
        subagentId: opts.subagentId,
        allowlist: opts.allowlist,
        isDelegateAttempt
      });
      // Context-specific refusal copy. The orchestrator gets an
      // actionable nudge to switch to `<delegate />` so the next
      // iteration produces visible work instead of repeating the
      // same bad tool call. Sub-agents get the original concise
      // message — they cannot re-delegate, they have to make do
      // with their assigned toolset.
      const refusalMessage =
        opts.subagentId === undefined
          ? `Tool "${tc.name}" is not callable from the orchestrator. ` +
          `The orchestrator's direct toolset is restricted to ${opts.allowlist.join(', ')}. ` +
          `Emit a \`<delegate id="..." task="..." files="..." tools="${tc.name}" />\` ` +
          `directive in your assistant text to spawn a sub-agent that can use \`${tc.name}\`.`
          : `Tool "${tc.name}" not in allowlist for this sub-agent.`;
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        name: tc.name,
        content: refusalMessage
      });
      continue;
    }

    const { args: parsed, parseError } = parseToolArgs(tc.name, tc.argumentsBuf);
    // Phase 2 — settle the in-flight diff stream for this callId
    // before emitting the authoritative `tool-call`. The streamer
    // drops its per-call state synchronously so subsequent deltas
    // (if any race in) are silently ignored. Renderer-side
    // reconciliation also drops the partial entry on this event.
    //
    // `owner` is forwarded so the streamer can also reconcile any
    // stale `pending:${owner}:${index}` surrogate state that was
    // created when the provider's first delta lacked a real id.
    // The streamer's lowest-index walk does the index resolution.
    opts.onToolCallSettled?.(callId, opts.subagentId ?? 'orc');
    emit({
      kind: 'tool-call',
      id: randomUUID(),
      ts: Date.now(),
      call: {
        id: callId,
        name: tc.name as ToolName,
        args: parsed,
        // Phase 9 (2026): forward Gemini's per-call thoughtSignature
        // onto the persisted tool-call event so transcript replay
        // can re-attach it to the matching `tool_calls[i]` slot on
        // the assistant message. Other dialects emit no signature;
        // the field stays absent (the spread is conditional).
        ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
          ? { thoughtSignature: tc.thoughtSignature }
          : {})
      },
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });
    // Short-circuit on structural argument parse failure (review
    // finding M6). Dispatching the tool with `{}` would either
    // throw a tool-specific "missing path" / "missing command"
    // (wasting a model round-trip on a confusing downstream
    // error) or silently succeed with empty args (worse — model
    // never learns it sent broken JSON). The synthetic
    // `tool-result` carries the precise parse diagnostic so the
    // model's next iteration can correct the call directly.
    if (parseError !== undefined) {
      attempted += 1;
      failed += 1;
      const syntheticResult = {
        id: callId,
        name: tc.name as ToolName,
        ok: false as const,
        output: parseError,
        error: 'argument parse failed',
        durationMs: 0
      };
      emit({
        kind: 'tool-result',
        id: randomUUID(),
        ts: Date.now(),
        result: syntheticResult,
        ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
      });
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        name: tc.name,
        content: parseError
      });
      continue;
    }
    // Live status for every dispatched tool — orchestrator tail row and
    // sub-agent trace cards surface "Exploring" via ephemeral
    // `run-status` (no persisted phase divider — that duplicated the
    // tail row every tool round).
    emitRunStatus(emit, 'running-tool', 'Exploring', {
      toolName: tc.name,
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });
    attempted += 1;
    const result = await runToolByName(tc.name, parsed, {
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      conversationId: opts.conversationId,
      permissions: opts.permissions,
      strictApprovals: opts.strictApprovals,
      emit,
      signal: opts.signal,
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });
    if (!result.ok) failed += 1;
    // Override the tool's internally-generated id with the LLM's tool-call
    // id so the tool-result timeline event correlates with the tool-call.
    // Replay reads `result.id` as the `tool_call_id` for the model — this
    // is what unblocks OpenAI-compat providers (e.g. DeepSeek) on the
    // next turn.
    result.id = callId;
    emit({
      kind: 'tool-result',
      id: randomUUID(),
      ts: Date.now(),
      result,
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });

    // Surface a file-edit card whenever `edit` produced a successful
    // result with structured metadata. With the orchestrator policy in
    // place this typically only fires from sub-agents — but if a future
    // change re-allows `edit` at orchestrator level, the UI stays honest.
    if (tc.name === 'edit' && result.ok && result.data && result.data.tool === 'edit') {
      emit({
        kind: 'file-edit',
        id: randomUUID(),
        ts: Date.now(),
        runId: opts.runId,
        filePath: result.data.filePath,
        additions: result.data.additions,
        deletions: result.data.deletions,
        ...(result.data.entryId ? { entryId: result.data.entryId } : {}),
        ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
      });
    }
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: tc.name,
      content: result.output
    });
  }
  if (orchestratorDelegateRefusals > 0) {
    // One phase row per round — parallel `delegate` tool calls in a
    // single batch previously emitted N identical dividers (observed
    // live when the model tried to spawn eight sub-agents via
    // function-calling instead of XML directives).
    const n = orchestratorDelegateRefusals;
    emit({
      kind: 'phase',
      id: randomUUID(),
      ts: Date.now(),
      label:
        n === 1
          ? 'Agent called `delegate` as a tool (refused — use the XML directive)'
          : `Agent called \`delegate\` as a tool ${n} times (refused — emit \`<delegate ... />\` directives in your text)`
    });
  }
  log.debug('tool round summary', {
    attempted,
    failed,
    refused,
    childRedelegations,
    subagentId: opts.subagentId,
    ms: Date.now() - startedAt
  });
  return { attempted, failed, childRedelegations };
}
