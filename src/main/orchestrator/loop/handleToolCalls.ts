/**
 * Executes a batch of tool calls produced by ANY agent loop (orchestrator
 * or sub-agent) and emits the matching timeline events. The orchestrator's
 * catalogue is restricted by `tools/policy/orchestratorTools.ts` (only
 * `ls`, `read`, `memory` reach here at orchestrator level); sub-agents
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

/**
 * Coerce a streaming-tool-call's `argumentsBuf` into the
 * `Record<string, unknown>` shape the tool executor expects.
 *
 * Three failure modes were silently collapsing to `{}` before this
 * helper existed, and the symptom (e.g. `read` failing with
 * "missing path") looked like a model error:
 *
 *   1. Empty buffer — the model emitted a tool call with no
 *      arguments at all. `JSON.parse('')` throws.
 *   2. Malformed JSON — a provider truncated mid-stream or a
 *      non-conformant compat backend forwarded an object as a
 *      string ("[object Object]"). `JSON.parse` throws.
 *   3. Valid JSON but wrong shape — the buffer parses to `null`,
 *      a string, a number, or an array. The executor signature
 *      types it as `Record<string, unknown>` so destructuring would
 *      crash on `null` or surface as `args.path === undefined`.
 *
 * Any of these now degrades to `{}` AND emits a single warn-level
 * log line so the failure is debuggable from `vyotiq.log` instead of
 * being invisible.
 */
function parseToolArgs(name: string, buf: string): Record<string, unknown> {
  if (!buf) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf);
  } catch (err) {
    log.warn('tool arguments failed to JSON.parse — falling back to {}', {
      tool: name,
      buf: buf.slice(0, 200),
      err: err instanceof Error ? err.message : String(err)
    });
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log.warn('tool arguments parsed to non-record — falling back to {}', {
      tool: name,
      buf: buf.slice(0, 200),
      shape: parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed
    });
    return {};
  }
  return parsed as Record<string, unknown>;
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
  for (const tc of finishedToolCalls) {
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
        remaining: finishedToolCalls.length - (attempted + refused),
        subagentId: opts.subagentId
      });
      break;
    }
    if (!tc.name) continue;
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
      log.warn('allowlist refusal', {
        tool: tc.name,
        subagentId: opts.subagentId,
        allowlist: opts.allowlist
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

    const parsed = parseToolArgs(tc.name, tc.argumentsBuf);
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
      call: { id: callId, name: tc.name as ToolName, args: parsed },
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });
    // Live status only for orchestrator-level tool rounds. Sub-agent
    // tool execution is surfaced by the sub-agent's own trace card, so
    // bubbling it up into the top-level status row would produce a
    // confusing double signal when multiple sub-agents run in parallel.
    if (opts.subagentId === undefined) {
      emitRunStatus(emit, 'running-tool', `Running tool: ${tc.name}…`, {
        toolName: tc.name
      });
    }
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
  log.debug('tool round summary', {
    attempted,
    failed,
    refused,
    subagentId: opts.subagentId,
    ms: Date.now() - startedAt
  });
  return { attempted, failed };
}
