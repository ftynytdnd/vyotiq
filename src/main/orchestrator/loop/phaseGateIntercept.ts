/**
 * Intercepts `phase_gate` tool calls in the orchestrator loop.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import { insertHistoryBeforeTail } from '../context/buildContextLayers.js';
import { truncateToolOutputForContext } from '@shared/text/truncateUtf8Safe.js';
import type { PhaseEngine, PhaseGateHandleResult } from '../phased/phaseEngine.js';

export interface PhaseGateInterceptOpts {
  engine: PhaseEngine;
  tc: PartialToolCall;
  messages: ChatMessage[];
  emit: (event: TimelineEvent) => void;
  runId: string;
}

export type PhaseGateInterceptOutcome =
  | { kind: 'continued'; result: PhaseGateHandleResult }
  | { kind: 'all_done' };

async function settleToolResult(
  tc: PartialToolCall,
  messages: ChatMessage[],
  emit: (event: TimelineEvent) => void,
  output: string,
  ok: boolean
): Promise<void> {
  const callId = tc.id ?? randomUUID();
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result: {
      id: callId,
      name: 'phase_gate',
      ok,
      output,
      ...(ok ? {} : { error: 'phase_gate rejected' }),
      durationMs: 0
    }
  });
  insertHistoryBeforeTail(messages, {
    role: 'tool',
    tool_call_id: callId,
    name: 'phase_gate',
    content: truncateToolOutputForContext(output)
  });
}

export async function interceptPhaseGate(
  opts: PhaseGateInterceptOpts
): Promise<PhaseGateInterceptOutcome> {
  const args = tryParseArgumentsRecord(opts.tc.argumentsBuf ?? '{}');
  let handleResult = await opts.engine.handlePhaseGateArgs(args);
  if (handleResult.kind === 'verify_pending') {
    const verifyResult = await opts.engine.runPendingVerifyIfNeeded();
    if (verifyResult) handleResult = verifyResult;
  }

  // Blocked gates and schema errors are recoverable: return the reason so the
  // agent self-corrects in-phase. Run-level escalation to the human is owned
  // by the termination guards (no-progress / caps) at iteration start.
  if (handleResult.kind === 'blocked') {
    await settleToolResult(opts.tc, opts.messages, opts.emit, handleResult.reason, false);
    return { kind: 'continued', result: handleResult };
  }

  if (handleResult.kind === 'error') {
    await settleToolResult(opts.tc, opts.messages, opts.emit, handleResult.message, false);
    return { kind: 'continued', result: handleResult };
  }

  const output = JSON.stringify({ result: handleResult.kind, detail: handleResult });
  const ok =
    handleResult.kind === 'advanced' ||
    handleResult.kind === 'all_subtasks_done' ||
    handleResult.kind === 'looped_back';

  await settleToolResult(opts.tc, opts.messages, opts.emit, output, ok);

  if (handleResult.kind === 'all_subtasks_done') {
    return { kind: 'all_done' };
  }

  return { kind: 'continued', result: handleResult };
}
