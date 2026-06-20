import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';

describe('deriveRows — ask_user', () => {
  it('does not fold synthetic ask_user tool-result into an Asked tool-group', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'ask-user-prompt',
        id: 'prompt-1',
        ts: 1,
        displayText: 'Pick one',
        toolCallId: 'tc-1',
        runId: 'run-1',
        payload: {
          questions: [{ id: 'q1', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }] }]
        },
        status: 'submitted'
      },
      {
        kind: 'tool-result',
        id: 'tr-1',
        ts: 2,
        result: {
          id: 'tc-1',
          name: 'ask_user',
          ok: true,
          output: 'User answers:\nPick one\n  A (a)',
          durationMs: 0
        }
      }
    ];
    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'ask_user')).toBe(false);
    expect(rows.some((r) => r.kind === 'ask-user-prompt')).toBe(false);
  });

  it('does not fold ask_user tool-call into an Asking tool-group', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'tool-call',
        id: 'tc-1',
        ts: 1,
        call: { id: 'tc-1', name: 'ask_user', args: { question: 'Where is the code?' } }
      },
      {
        kind: 'ask-user-prompt',
        id: 'prompt-1',
        ts: 2,
        displayText: 'Where is the code?',
        toolCallId: 'tc-1',
        runId: 'run-1',
        payload: {
          questions: [{ id: 'q1', prompt: 'Where is the code?', options: [] }]
        }
      }
    ];
    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'ask_user')).toBe(false);
    expect(rows.some((r) => r.kind === 'ask-user-prompt')).toBe(true);
  });

  it('omits overlay ask-user-prompt rows from the timeline', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'ask-user-prompt',
        id: 'prompt-multi',
        ts: 1,
        displayText: 'Refinement',
        toolCallId: 'tc-1',
        runId: 'run-1',
        payload: {
          title: 'Implementation Refinement Questions',
          questions: [
            { id: 'q1', prompt: 'Q1', options: [{ id: 'a', label: 'A' }] },
            { id: 'q2', prompt: 'Q2', options: [{ id: 'b', label: 'B' }] },
            { id: 'q3', prompt: 'Q3', options: [{ id: 'c', label: 'C' }] }
          ]
        }
      }
    ];
    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'ask-user-prompt')).toBe(false);
  });
});
