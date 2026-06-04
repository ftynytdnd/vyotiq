/**
 * Replay must not materialize assistant.tool_calls that never received a
 * matching tool-result before a user-prompt boundary.
 */

import { describe, expect, it } from 'vitest';
import { replayTranscript } from '@main/orchestrator/replay/replayTranscript';
import { sanitizeToolCallPairingWithStats } from '@main/orchestrator/loop/sanitizeToolPairing';
import type { TimelineEvent } from '@shared/types/chat';

let nextTs = 1;
function ts(): number {
  return nextTs++;
}

describe('replayTranscript — unpaired tool calls', () => {
  it('drops tool_calls without tool-result before the next user-prompt', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: ts(), content: 'go' },
      { kind: 'agent-text-delta', id: 'a1', ts: ts(), delta: 'listing' },
      {
        kind: 'tool-call',
        id: 'tc-event',
        ts: ts(),
        call: { id: 'call-1', name: 'ls' as never, args: { path: 'src' } }
      },
      { kind: 'user-prompt', id: 'u2', ts: ts(), content: 'next' }
    ];

    const msgs = replayTranscript(events);
    const assistantWithTools = msgs.filter(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    expect(assistantWithTools).toHaveLength(0);

    const sanitized = sanitizeToolCallPairingWithStats(msgs);
    expect(sanitized.stats.injectedStubs).toBe(0);
    expect(sanitized.stats.droppedOrphans).toBe(0);
  });
});
