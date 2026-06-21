import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';
import { pauseRunForAskUser } from '@main/orchestrator/loop/askUserPause';
import { createRunStateAccumulator } from '@main/orchestrator/loop/buildRunState';
import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature';

vi.mock('@main/window/requestUserAttention.js', () => ({
  requestUserAttention: vi.fn()
}));

describe('pauseRunForAskUser', () => {
  it('does not insert a second assistant row — run loop owns history', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Which option?',
        tool_calls: [
          {
            id: 'tc-ask',
            type: 'function',
            function: { name: 'ask_user', arguments: '{"questions":[]}' }
          }
        ]
      }
    ];

    const emit = vi.fn();
    pauseRunForAskUser({
      askUserCall: { id: 'tc-ask', name: 'ask_user', argumentsBuf: '{"questions":[]}' },
      assistantText: 'Which option?',
      reasoningText: '',
      iteration: 0,
      runId: 'run-1',
      messages,
      query: 'hi',
      nextIteration: 1,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc: createRunStateAccumulator(),
      spin: createSpinSignatureBuffer(),
      runCumulativeTokens: 0,
      emit
    });

    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ask-user-prompt', toolCallId: 'tc-ask' })
    );
  });
});
