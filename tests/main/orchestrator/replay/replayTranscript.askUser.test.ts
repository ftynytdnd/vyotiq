/**
 * ask_user pause → submit → resume replay pairing (no orphan tool rows).
 */

import { describe, expect, it } from 'vitest';
import { replayTranscript } from '@main/orchestrator/replay/replayTranscript';
import { sanitizeToolCallPairingWithStats } from '@main/orchestrator/loop/sanitizeToolPairing';
import type { TimelineEvent } from '@shared/types/chat';

const askPayload = {
  questions: [
    {
      id: 'drop',
      prompt: 'Drop the legacy column?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' }
      ]
    }
  ]
};

describe('replayTranscript ask_user pairing', () => {
  it('pairs ask-user-prompt tool_calls with ask_user tool-result after submit', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 1, content: 'Which option?' },
      {
        kind: 'ask-user-prompt',
        id: 'ask-1',
        ts: 2,
        displayText: 'Drop the legacy column?',
        toolCallId: 'tc-ask',
        runId: 'run-1',
        payload: askPayload
      },
      {
        kind: 'ask-user-submitted',
        id: 'sub-1',
        ts: 3,
        promptEventId: 'ask-1',
        toolCallId: 'tc-ask',
        runId: 'run-1'
      },
      { kind: 'user-prompt', id: 'u2', ts: 4, content: 'Yes' },
      {
        kind: 'tool-result',
        id: 'tr-1',
        ts: 5,
        result: {
          id: 'tc-ask',
          name: 'ask_user',
          ok: true,
          output: 'User selected: yes',
          durationMs: 0
        }
      },
      { kind: 'agent-text-delta', id: 'a-1', ts: 6, delta: 'Done.' }
    ];

    const msgs = replayTranscript(events);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant']);

    const assistant = msgs[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.tool_calls?.[0]?.function.name).toBe('ask_user');
    expect(assistant?.tool_calls?.[0]?.id).toBe('tc-ask');

    const tool = msgs[2];
    expect(tool?.role).toBe('tool');
    expect(tool?.tool_call_id).toBe('tc-ask');
    expect(tool?.name).toBe('ask_user');

    const answerUser = msgs[3];
    expect(answerUser?.role).toBe('user');
    expect(answerUser?.content).toContain('Yes');

    const sanitized = sanitizeToolCallPairingWithStats(msgs);
    expect(sanitized.stats.droppedOrphans).toBe(0);
    expect(sanitized.stats.injectedStubs).toBe(0);
  });

  it('ignores duplicate ask_user tool-result after the first paired row', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 1, content: 'Go' },
      {
        kind: 'ask-user-prompt',
        id: 'ask-1',
        ts: 2,
        displayText: 'Confirm?',
        toolCallId: 'tc-ask',
        runId: 'run-1',
        payload: askPayload
      },
      {
        kind: 'ask-user-submitted',
        id: 'sub-1',
        ts: 3,
        promptEventId: 'ask-1',
        toolCallId: 'tc-ask',
        runId: 'run-1'
      },
      { kind: 'user-prompt', id: 'u2', ts: 4, content: 'Yes' },
      {
        kind: 'tool-result',
        id: 'tr-1',
        ts: 5,
        result: {
          id: 'tc-ask',
          name: 'ask_user',
          ok: true,
          output: 'User selected: yes',
          durationMs: 0
        }
      },
      {
        kind: 'tool-result',
        id: 'tr-dup',
        ts: 6,
        result: {
          id: 'tc-ask',
          name: 'ask_user',
          ok: true,
          output: 'duplicate row',
          durationMs: 0
        }
      }
    ];

    const msgs = replayTranscript(events);
    const toolRows = msgs.filter((m) => m.role === 'tool');
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0]?.content).toContain('User selected');

    const sanitized = sanitizeToolCallPairingWithStats(msgs);
    expect(sanitized.stats.droppedOrphans).toBe(0);
  });
});
