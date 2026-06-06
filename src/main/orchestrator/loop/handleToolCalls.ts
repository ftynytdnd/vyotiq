/**
 * Executes a batch of tool calls for Agent V and emits matching timeline events.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatPermissions, TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import { runToolByName } from '../toolRunner.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { emitFinishToolSettlement, resolveFinishSummary } from './finishIntercept.js';
import { emitRunStatus } from './emitRunStatus.js';
import { batchIndicesByDependencies, parseDependsOnIds } from './toolDependencyBatches.js';
import { parseToolArgs } from './parseToolArgs.js';
import { validateToolArgs } from './validateToolArgs.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/handleToolCalls');

function settleToolCallSurrogate(
  tc: PartialToolCall,
  opts: HandleToolCallsOpts,
  batchIndex: number
): void {
  const callId = tc.id;
  if (!callId) return;
  opts.onToolCallSettled?.(callId, 'orc', batchIndex);
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
  workspaceId: string;
  runId: string;
  conversationId: string;
  permissions: ChatPermissions;
  signal: AbortSignal;
  /** When set, calls outside this list get a synthetic tool failure. */
  allowlist?: readonly string[];
  skipDependencyBatching?: boolean;
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
  /** Most recent failed tool output in this round (for terminal error copy). */
  lastFailure?: string;
}

type DispatchOutcome =
  | { kind: 'skipped' }
  | { kind: 'ran'; attempted: number; failed: number; failureDetail?: string };

async function dispatchOneToolCall(
  tc: PartialToolCall,
  batchIndex: number,
  messages: ChatMessage[],
  emit: (event: TimelineEvent) => void,
  opts: HandleToolCallsOpts,
  tallies: { refused: number }
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
  const canonical = normalizeRegisteredToolName(tc.name);
  if (canonical) tc.name = canonical;
  if (!tc.id) tc.id = randomUUID();
  const callId = tc.id;

  if (canonical === 'finish') {
    const summary = resolveFinishSummary(tc, '');
    emitFinishToolSettlement(tc, summary, emit, messages);
    settleToolCallSurrogate(tc, opts, batchIndex);
    return { kind: 'skipped' };
  }
  if (canonical === 'ask_user') {
    tallies.refused += 1;
    log.warn('ask_user reached handleToolCalls — run loop should intercept', {
      callId
    });
    settleToolCallSurrogate(tc, opts, batchIndex);
    return { kind: 'skipped' };
  }

  if (opts.allowlist && !opts.allowlist.includes(tc.name)) {
    tallies.refused += 1;
    log.warn('allowlist refusal', {
      tool: tc.name,
      allowlist: opts.allowlist
    });
    const refusalMessage =
      `Tool "${tc.name}" is not in the agent allowlist (${opts.allowlist.join(', ')}).`;
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
  opts.onToolCallSettled?.(callId, 'orc', batchIndex);
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
    }
  });
  if (parseError !== undefined) {
    log.warn('tool arguments failed to parse', {
      tool: tc.name,
      callId,
      error: 'argument parse failed'
    });
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
    });
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: tc.name,
      content: parseError
    });
    return {
      kind: 'ran',
      attempted: 1,
      failed: 1,
      failureDetail: formatToolFailureDetail(tc.name, parseError, 'argument parse failed')
    };
  }

  const validation = validateToolArgs(tc.name, parsed);
  if (!validation.ok) {
    log.warn('tool arguments rejected before dispatch', {
      tool: tc.name,
      callId,
      error: validation.error
    });
    const syntheticResult = {
      id: callId,
      name: tc.name as ToolName,
      ok: false as const,
      output: validation.output,
      error: validation.error,
      durationMs: 0
    };
    emit({
      kind: 'tool-result',
      id: randomUUID(),
      ts: Date.now(),
      result: syntheticResult
    });
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: tc.name,
      content: validation.output
    });
    return {
      kind: 'ran',
      attempted: 1,
      failed: 1,
      failureDetail: formatToolFailureDetail(tc.name, validation.output, validation.error)
    };
  }

  emitRunStatus(emit, 'running-tool', 'Exploring', { toolName: tc.name });
  const result = await runToolByName(tc.name, parsed, {
    workspacePath: opts.workspacePath,
    workspaceId: opts.workspaceId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    permissions: opts.permissions,
    emit,
    signal: opts.signal
  });
  result.id = callId;
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result
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
      ...(result.data.entryId ? { entryId: result.data.entryId } : {})
    });
  }
  messages.push({
    role: 'tool',
    tool_call_id: callId,
    name: tc.name,
    content: result.output
  });
  return {
    kind: 'ran',
    attempted: 1,
    failed: result.ok ? 0 : 1,
    ...(!result.ok
      ? {
          failureDetail: formatToolFailureDetail(tc.name ?? 'unknown', result.output, result.error)
        }
      : {})
  };
}

function formatToolFailureDetail(toolName: string, output: string, error?: string): string {
  const detail = error ? `${toolName} — ${error}` : `${toolName} — ${output}`;
  return detail.length > 160 ? `${detail.slice(0, 157)}…` : detail;
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
  let lastFailure: string | undefined;
  const tallies = { refused: 0 };

  const recordFailure = (detail?: string) => {
    if (detail) lastFailure = detail;
  };

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
        recordFailure(o.failureDetail);
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
        recordFailure(o.failureDetail);
      }
    }
  }

  if (failed > 0) {
    log.warn('tool round had failures', {
      attempted,
      failed,
      refused: tallies.refused,
      lastFailure,
      ms: Date.now() - startedAt
    });
  } else {
    log.debug('tool round summary', {
      attempted,
      failed,
      refused: tallies.refused,
      ms: Date.now() - startedAt
    });
  }
  return { attempted, failed, ...(lastFailure ? { lastFailure } : {}) };
}
