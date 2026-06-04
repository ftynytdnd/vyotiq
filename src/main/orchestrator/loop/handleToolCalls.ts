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
import { batchIndicesByDependencies, parseDependsOnIds } from './toolDependencyBatches.js';
import { parseToolArgs, tryParseArgumentsRecord } from './parseToolArgs.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/handleToolCalls');

function suggestDelegateCall(tc: PartialToolCall, refusedTool: string): string {
  let id = 'w1';
  let task = 'One micro-task description';
  let files: string[] = [];
  const tools = [refusedTool];
  const parsed = tryParseArgumentsRecord(tc.argumentsBuf);
  if (typeof parsed['id'] === 'string' && parsed['id'].trim()) id = parsed['id'].trim();
  if (typeof parsed['task'] === 'string' && parsed['task'].trim()) task = parsed['task'].trim();
  if (typeof parsed['path'] === 'string' && parsed['path'].trim()) files = [parsed['path'].trim()];
  if (typeof parsed['file'] === 'string' && parsed['file'].trim()) files = [parsed['file'].trim()];
  const args: Record<string, unknown> = { id, task, tools };
  if (files.length > 0) args['files'] = files;
  return JSON.stringify({ name: 'delegate', arguments: args });
}

function settleToolCallSurrogate(
  tc: PartialToolCall,
  opts: HandleToolCallsOpts,
  batchIndex: number
): void {
  const callId = tc.id;
  if (!callId) return;
  opts.onToolCallSettled?.(callId, opts.subagentId ?? 'orc', batchIndex);
}

function emitSyntheticToolFailure(
  tc: PartialToolCall,
  emit: (event: TimelineEvent) => void,
  messages: ChatMessage[],
  opts: HandleToolCallsOpts,
  output: string,
  error: string,
  batchIndex: number
): void {
  const callId = tc.id ?? randomUUID();
  if (!tc.id) tc.id = callId;
  settleToolCallSurrogate(tc, opts, batchIndex);
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

export interface HandleToolCallsOpts {
  workspacePath: string;
  /** Workspace id (registry id) — required for checkpoint snapshots. */
  workspaceId: string;
  /** Run id (orchestrator-assigned). */
  runId: string;
  /** Conversation id that owns the run. */
  conversationId: string;
  permissions: ChatPermissions;
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
   * When true, caller already batched by `depends_on` (e.g. `dispatchMixedTurn`);
   * run all calls in one parallel batch without re-toposorting.
   */
  skipDependencyBatching?: boolean;
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
  /**
   * When set, emit at most one "cannot nest further" phase per sub-agent id
   * per run (sub-agents may retry `delegate` many times in one turn).
   */
  nestedDelegatePhaseEmitted?: Set<string>;
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
   * Number of refused `delegate` tool calls in this round. `delegate`
   * is a first-class orchestrator tool, so the orchestrator never
   * refuses it here (and the run loop intercepts it by name before
   * this function runs). This counter therefore only ever increments
   * for a SUB-AGENT attempting to nest a further delegation — its
   * allowlist excludes `delegate`. Pure observability; does not affect
   * the allowlist refusal itself.
   */
  childRedelegations: number;
}

type DispatchOutcome =
  | { kind: 'skipped' }
  | { kind: 'ran'; attempted: number; failed: number };

async function dispatchOneToolCall(
  tc: PartialToolCall,
  batchIndex: number,
  messages: ChatMessage[],
  emit: (event: TimelineEvent) => void,
  opts: HandleToolCallsOpts,
  tallies: { refused: number; childRedelegations: number }
): Promise<DispatchOutcome> {
  if (!tc.name) {
    tallies.refused += 1;
    if (!tc.id) tc.id = randomUUID();
    emitSyntheticToolFailure(
      tc,
      emit,
      messages,
      opts,
      'Tool call missing a name — cannot execute.',
      'missing tool name',
      batchIndex
    );
    return { kind: 'skipped' };
  }
  if (!tc.id) tc.id = randomUUID();
  const callId = tc.id;

  if (opts.allowlist && !opts.allowlist.includes(tc.name)) {
    tallies.refused += 1;
    const isDelegateAttempt = tc.name === 'delegate';
    if (isDelegateAttempt) {
      tallies.childRedelegations += 1;
      // The nested-delegate refusal is fed back to the model through the
      // refused tool result itself, so the extra "cannot nest further"
      // timeline `phase` row was redundant clutter — dropped. The
      // `nestedDelegatePhaseEmitted` de-dupe set is retained in opts for
      // back-compat with callers but is no longer written here.
    }
    log.warn('allowlist refusal', {
      tool: tc.name,
      subagentId: opts.subagentId,
      allowlist: opts.allowlist,
      isDelegateAttempt
    });
    const refusalMessage =
      opts.subagentId === undefined
        ? `Tool "${tc.name}" is not callable from the orchestrator. ` +
          `The orchestrator's direct toolset is restricted to ${opts.allowlist.join(', ')}. ` +
          `To run "${tc.name}", call the \`delegate\` tool and grant it via the \`tools\` argument, for example:\n\n` +
          suggestDelegateCall(tc, tc.name) +
          `\n\nSpawn one sub-agent per micro-task.`
        : `Tool "${tc.name}" is not available for this sub-agent — use the granted toolset.`;
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: tc.name,
      content: refusalMessage
    });
    settleToolCallSurrogate(tc, opts, batchIndex);
    return { kind: 'skipped' };
  }

  const { args: parsed, parseError } = parseToolArgs(tc.name, tc.argumentsBuf);
  opts.onToolCallSettled?.(callId, opts.subagentId ?? 'orc', batchIndex);
  emit({
    kind: 'tool-call',
    id: randomUUID(),
    ts: Date.now(),
    call: {
      id: callId,
      name: tc.name as ToolName,
      args: parsed,
      ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
        ? { thoughtSignature: tc.thoughtSignature }
        : {})
    },
    ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
  });
  if (parseError !== undefined) {
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
    return { kind: 'ran', attempted: 1, failed: 1 };
  }

  emitRunStatus(emit, 'running-tool', 'Exploring', {
    toolName: tc.name,
    ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
  });
  const result = await runToolByName(tc.name, parsed, {
    workspacePath: opts.workspacePath,
    workspaceId: opts.workspaceId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    permissions: opts.permissions,
    emit,
    signal: opts.signal,
    ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
  });
  result.id = callId;
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result,
    ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
  });
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
  return { kind: 'ran', attempted: 1, failed: result.ok ? 0 : 1 };
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
  const tallies = { refused: 0, childRedelegations: 0 };

  const batches = opts.skipDependencyBatching
    ? [finishedToolCalls.map((_, i) => i)]
    : batchIndicesByDependencies(
        finishedToolCalls.map((tc, i) => {
          if (!tc.id) tc.id = randomUUID();
          let dependsOn: string[] = [];
          if (tc.name) {
            const { args } = parseToolArgs(tc.name, tc.argumentsBuf);
            dependsOn = parseDependsOnIds(args);
          }
          return { id: tc.id!, dependsOn, index: i };
        }).map((d) => ({ id: d.id, dependsOn: d.dependsOn }))
      );
  const processed = new Set<number>();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;
    if (opts.signal.aborted) {
      log.debug('tool round aborted mid-batch', {
        remaining: batch.length,
        subagentId: opts.subagentId
      });
      for (let b = batchIdx; b < batches.length; b++) {
        for (const i of batches[b]!) {
          if (processed.has(i)) continue;
          processed.add(i);
          tallies.refused += 1;
          emitSyntheticToolFailure(
            finishedToolCalls[i]!,
            emit,
            messages,
            opts,
            'Tool call aborted because the run was stopped or superseded.',
            'aborted',
            i
          );
        }
      }
      break;
    }

    const syncIndices: number[] = [];
    const runnable: number[] = [];
    for (const i of batch) {
      const tc = finishedToolCalls[i]!;
      if (
        !tc.name ||
        (opts.allowlist && !opts.allowlist.includes(tc.name)) ||
        parseToolArgs(tc.name, tc.argumentsBuf).parseError !== undefined
      ) {
        syncIndices.push(i);
        continue;
      }
      runnable.push(i);
    }

    for (const i of syncIndices) {
      processed.add(i);
      const o = await dispatchOneToolCall(
        finishedToolCalls[i]!,
        i,
        messages,
        emit,
        opts,
        tallies
      );
      if (o.kind === 'ran') {
        attempted += o.attempted;
        failed += o.failed;
      }
    }

    // Independent calls in a batch overlap; timeline JSONL order stays
    // stable because conversationStore serializes per-conversation appends.
    const outcomes = await Promise.all(
      runnable.map(async (i) => {
        const o = await dispatchOneToolCall(
          finishedToolCalls[i]!,
          i,
          messages,
          emit,
          opts,
          tallies
        );
        processed.add(i);
        return o;
      })
    );
    for (const o of outcomes) {
      if (o.kind === 'ran') {
        attempted += o.attempted;
        failed += o.failed;
      }
    }
  }

  log.debug('tool round summary', {
    attempted,
    failed,
    refused: tallies.refused,
    childRedelegations: tallies.childRedelegations,
    subagentId: opts.subagentId,
    ms: Date.now() - startedAt
  });
  return { attempted, failed, childRedelegations: tallies.childRedelegations };
}
