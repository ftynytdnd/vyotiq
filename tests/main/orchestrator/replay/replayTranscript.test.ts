/**
 * `replayTranscript.ts` tests. Exercises the Phase-1 fixes:
 *   - Aborted sub-agent rounds (spawn + status, no result) still emit
 *     a placeholder envelope entry with status="aborted".
 *   - Re-spawning a sub-agent id across rounds picks up the LATEST
 *     status, not the first one seen.
 *   - Stale `pendingCallIds` are cleared at sub-agent-round and
 *     user-prompt boundaries.
 *   - tool-result pairing happens by ORDER, not by `result.id`.
 */

import { describe, expect, it } from 'vitest';
import { replayTranscript } from '@main/orchestrator/replay/replayTranscript';
import type { TimelineEvent, ChatMessage } from '@shared/types/chat';

let nextTs = 1;
function ts(): number {
  return nextTs++;
}
function evt<T extends TimelineEvent>(e: T): T {
  return e;
}

function userPrompt(content: string, id = `u-${ts()}`): TimelineEvent {
  return evt({ kind: 'user-prompt', id, ts: ts(), content });
}
function textDelta(id: string, delta: string): TimelineEvent {
  return evt({ kind: 'agent-text-delta', id, ts: ts(), delta });
}
function toolCall(id: string, callId: string, name: string, args: object): TimelineEvent {
  return evt({
    kind: 'tool-call',
    id,
    ts: ts(),
    call: { id: callId, name: name as never, args: args as Record<string, unknown> }
  } as TimelineEvent);
}
function toolResult(id: string, resultId: string, name: string, output: string): TimelineEvent {
  return evt({
    kind: 'tool-result',
    id,
    ts: ts(),
    result: { id: resultId, name: name as never, ok: true, output, durationMs: 1 }
  } as TimelineEvent);
}
function spawn(subagentId: string, task = 'do something'): TimelineEvent {
  return evt({
    kind: 'subagent-spawn',
    id: `sp-${ts()}`,
    ts: ts(),
    subagentId,
    task,
    files: [],
    tools: []
  });
}
function status(subagentId: string, s: 'done' | 'failed' | 'aborted'): TimelineEvent {
  return evt({
    kind: 'subagent-status',
    id: `st-${ts()}`,
    ts: ts(),
    subagentId,
    status: s
  });
}
function result(subagentId: string, output: string): TimelineEvent {
  return evt({
    kind: 'subagent-result',
    id: `r-${ts()}`,
    ts: ts(),
    subagentId,
    output
  });
}

describe('replayTranscript', () => {
  it('round-trips a simple user→assistant→tool→tool-result conversation', () => {
    const events: TimelineEvent[] = [
      userPrompt('hi'),
      textDelta('a-1', 'hello there'),
      toolCall('a-1', 'call-1', 'bash', { command: 'ls' }),
      toolResult('a-1', 'call-1', 'bash', 'README.md\nsrc/')
    ];
    const msgs = replayTranscript(events);
    expect(msgs.map((m: ChatMessage) => m.role)).toEqual([
      'user',
      'assistant',
      'tool'
    ]);
    expect(msgs[0]?.content).toContain('<turn>');
    expect(msgs[0]?.content).toMatch(/<user_message>\s*hi\s*<\/user_message>/);
    const a = msgs[1];
    expect(a?.role).toBe('assistant');
    expect((a as { tool_calls?: unknown[] }).tool_calls?.length).toBe(1);
    const t = msgs[2] as { role: 'tool'; tool_call_id: string; name: string };
    expect(t.tool_call_id).toBe('call-1');
    expect(t.name).toBe('bash');
  });

  it('prefers id-based pairing when a tool-result id matches a pending call id', () => {
    // Regression: when only a MIDDLE tool-result was persisted before
    // an abort (assistant emitted A, B, C; only B's result persisted),
    // the older FIFO-only pairing attached B's output to call-A,
    // misleading the model. The new policy prefers id-match and falls
    // back to FIFO only when the id isn't in the pending queue. Here
    // we emit A, B, C but only B's result — the surviving tool message
    // MUST carry tool_call_id = call-B.
    const events: TimelineEvent[] = [
      userPrompt('three steps'),
      textDelta('a-1', 'ok'),
      toolCall('a-1', 'call-A', 'bash', { command: 'ls' }),
      toolCall('a-1', 'call-B', 'read', { path: 'b.txt' }),
      toolCall('a-1', 'call-C', 'bash', { command: 'pwd' }),
      // Only B's result survives — A and C were in flight when the run
      // aborted. Id-pairing attaches this to call-B, not call-A (FIFO).
      toolResult('a-1', 'call-B', 'read', 'middle output')
    ];
    const msgs = replayTranscript(events);
    const tools = msgs.filter((m) => m.role === 'tool') as Array<{
      tool_call_id: string;
      content: string;
      name: string;
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.tool_call_id).toBe('call-B');
    expect(tools[0]?.name).toBe('read');
    expect(tools[0]?.content).toBe('middle output');
  });

  it('pairs tool-result by ORDER even when result.id drifts from call.id', () => {
    const events: TimelineEvent[] = [
      userPrompt('do two things'),
      textDelta('a-1', 'okay'),
      toolCall('a-1', 'call-A', 'bash', { command: 'ls' }),
      toolCall('a-1', 'call-B', 'read', { path: 'a.txt' }),
      // Drifted result ids on purpose — pairing must still match by order.
      toolResult('a-1', 'GENERATED-X', 'bash', 'first output'),
      toolResult('a-1', 'GENERATED-Y', 'read', 'second output')
    ];
    const msgs = replayTranscript(events);
    const tools = msgs.filter((m) => m.role === 'tool') as Array<{
      tool_call_id: string;
      content: string;
    }>;
    expect(tools).toHaveLength(2);
    expect(tools[0]?.tool_call_id).toBe('call-A');
    expect(tools[0]?.content).toBe('first output');
    expect(tools[1]?.tool_call_id).toBe('call-B');
    expect(tools[1]?.content).toBe('second output');
  });

  it('synthesizes a placeholder when a sub-agent round was aborted', () => {
    const events: TimelineEvent[] = [
      userPrompt('delegate'),
      spawn('sa-1', 'task one'),
      status('sa-1', 'aborted')
      // No subagent-result — abort happened before we got one.
    ];
    const msgs = replayTranscript(events);
    // Last message should be the synthetic envelope.
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('<subagent_results>');
    expect(last?.content).toMatch(/status="aborted"/);
    expect(last?.content).toMatch(/no result emitted/);
  });

  it('uses the LATEST status for a re-spawned sub-agent id across rounds', () => {
    const events: TimelineEvent[] = [
      // Round 1: sa-1 fails.
      userPrompt('p1'),
      spawn('sa-1', 'first'),
      status('sa-1', 'failed'),
      result('sa-1', '<status>failed</status>'),
      // Round 2: sa-1 re-runs and succeeds. Latest status is `done`.
      userPrompt('p2'),
      spawn('sa-1', 'second'),
      status('sa-1', 'done'),
      result('sa-1', '<status>success</status>')
    ];
    const msgs = replayTranscript(events);
    const envelopes = msgs.filter(
      (m): m is ChatMessage & { role: 'user'; content: string } =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('<subagent_results>')
    );
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]?.content).toContain('status="failed"');
    expect(envelopes[1]?.content).toContain('status="done"');
  });

  it('drops unpaired tool-call ids at the user-prompt boundary', () => {
    const events: TimelineEvent[] = [
      userPrompt('first turn'),
      textDelta('a-1', 'thinking'),
      toolCall('a-1', 'orphan-call', 'bash', { command: 'ls' }),
      // No tool-result — user interrupts with a new prompt.
      userPrompt('never mind'),
      textDelta('a-2', 'okay'),
      toolCall('a-2', 'real-call', 'read', { path: 'a' }),
      toolResult('a-2', 'real-call', 'read', 'content')
    ];
    const msgs = replayTranscript(events);
    const tools = msgs.filter((m) => m.role === 'tool') as Array<{ tool_call_id: string }>;
    // Only the second tool-result paired; the orphan was dropped at the
    // user-prompt boundary.
    expect(tools).toHaveLength(1);
    expect(tools[0]?.tool_call_id).toBe('real-call');
  });

  it('skips sub-agent internal tool-call/-result events', () => {
    const events: TimelineEvent[] = [
      userPrompt('go'),
      spawn('sa-1', 'task'),
      // These two should be IGNORED — sub-agent internals never reach orchestrator memory.
      {
        kind: 'tool-call',
        id: 'inner',
        ts: ts(),
        call: { id: 'sa-call', name: 'bash' as never, args: {} },
        subagentId: 'sa-1'
      },
      {
        kind: 'tool-result',
        id: 'inner',
        ts: ts(),
        result: {
          id: 'sa-call',
          name: 'bash' as never,
          ok: true,
          output: 'inner-output',
          durationMs: 1
        },
        subagentId: 'sa-1'
      },
      result('sa-1', '<status>success</status>')
    ];
    const msgs = replayTranscript(events);
    // No `role:'tool'` for the sub-agent's internal call.
    const tools = msgs.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(0);
    // The envelope is present.
    const last = msgs[msgs.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('<subagent_results>');
  });

  it('returns an empty array for an empty transcript', () => {
    expect(replayTranscript([])).toEqual([]);
  });
});
