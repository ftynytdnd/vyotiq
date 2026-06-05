/**
 * Shared helpers for the orchestrator's `finish` intercept path.
 * The run loop handles terminal settlement; `handleToolCalls` uses the
 * same emitter as a belt-and-suspenders guard when a finish call slips
 * through.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { parseStringArgFromBuf, tryParseArgumentsRecord } from './parseToolArgs.js';

export function resolveFinishSummary(
  finishCall: PartialToolCall,
  fallbackProse: string
): string {
  return (
    parseStringArgFromBuf(finishCall.argumentsBuf, 'summary') ||
    fallbackProse.trim() ||
    'Done.'
  );
}

export function emitFinishToolSettlement(
  finishCall: PartialToolCall,
  summary: string,
  emit: (event: TimelineEvent) => void,
  messages?: ChatMessage[]
): void {
  const callId = finishCall.id ?? randomUUID();
  if (!finishCall.id) finishCall.id = callId;
  finishCall.name = 'finish';

  const parsed = tryParseArgumentsRecord(finishCall.argumentsBuf);
  const args = { ...parsed };
  if (typeof args.summary !== 'string' || !args.summary.trim()) {
    args.summary = summary;
  }

  emit({
    kind: 'tool-call',
    id: randomUUID(),
    ts: Date.now(),
    call: {
      id: callId,
      name: 'finish' as ToolName,
      args,
      ...(typeof finishCall.thoughtSignature === 'string' &&
      finishCall.thoughtSignature.length > 0
        ? { thoughtSignature: finishCall.thoughtSignature }
        : {})
    }
  });

  const result = {
    id: callId,
    name: 'finish' as ToolName,
    ok: true as const,
    output: summary,
    durationMs: 0
  };
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result
  });

  messages?.push({
    role: 'tool',
    tool_call_id: callId,
    name: 'finish',
    content: summary
  });
}
