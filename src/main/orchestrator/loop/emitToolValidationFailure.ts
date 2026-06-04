/**
 * Orchestrator-level synthetic tool-call failures (validation errors that
 * never reach the generic tool executor).
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';

export function emitOrchestratorToolValidationFailure(
  tc: PartialToolCall,
  emit: (event: TimelineEvent) => void,
  messages: ChatMessage[],
  output: string,
  error: string,
  onToolCallSettled?: (callId: string, owner?: string, index?: number) => void
): void {
  if (!tc.id) tc.id = randomUUID();
  const callId = tc.id;
  const name = (tc.name ?? 'unknown') as ToolName;
  onToolCallSettled?.(callId, 'orc', 0);
  emit({
    kind: 'tool-call',
    id: randomUUID(),
    ts: Date.now(),
    call: {
      id: callId,
      name,
      args: tryParseArgumentsRecord(tc.argumentsBuf) ?? {}
    }
  });
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result: {
      id: callId,
      name,
      ok: false as const,
      output,
      error,
      durationMs: 0
    }
  });
  messages.push({
    role: 'tool',
    tool_call_id: callId,
    name: tc.name ?? 'unknown',
    content: output
  });
}
