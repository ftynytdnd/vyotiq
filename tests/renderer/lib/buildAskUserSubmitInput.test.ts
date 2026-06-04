import { describe, expect, it } from 'vitest';
import { buildAskUserSubmitInput } from '@renderer/lib/buildAskUserSubmitInput';
import type { PendingAskUserEvent } from '@renderer/lib/pendingAskUser';

const pending = {
  kind: 'ask-user-prompt',
  id: 'prompt-1',
  ts: 1,
  displayText: 'Pick',
  toolCallId: 'tc-1',
  runId: 'run-1',
  payload: {
    questions: [
      {
        id: 'q1',
        prompt: 'Pick',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' }
        ]
      },
      {
        id: 'q2',
        prompt: 'Other',
        options: [{ id: 'x', label: 'X' }]
      }
    ]
  }
} satisfies PendingAskUserEvent;

describe('buildAskUserSubmitInput', () => {
  it('uses supplementText for multi-question prompts', () => {
    const input = buildAskUserSubmitInput({
      pending,
      runId: 'run-1',
      conversationId: 'conv-1',
      answers: [
        { questionId: 'q1', selectedOptionIds: ['a'] },
        { questionId: 'q2', skipped: true }
      ],
      supplementText: 'Also note the staging env.'
    });
    expect(input.supplementText).toBe('Also note the staging env.');
    expect(input.answers[0]?.selectedOptionIds).toEqual(['a']);
  });
});
