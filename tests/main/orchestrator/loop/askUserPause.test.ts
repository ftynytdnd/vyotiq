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

  it('inserts assistant ask_user row when deferred after co-emitted tools', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-edit', type: 'function', function: { name: 'edit', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc-edit', content: 'ok' }
    ];

    const emit = vi.fn();
    pauseRunForAskUser({
      askUserCall: { id: 'tc-ask', name: 'ask_user', argumentsBuf: '{"questions":[]}' },
      assistantText: 'Need a choice',
      reasoningText: '',
      iteration: 1,
      runId: 'run-1',
      messages,
      query: 'hi',
      nextIteration: 2,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc: createRunStateAccumulator(),
      spin: createSpinSignatureBuffer(),
      runCumulativeTokens: 0,
      emit,
      deferred: true
    });

    const askAssistant = messages.find(
      (m) =>
        m.role === 'assistant' &&
        m.tool_calls?.some((tc) => tc.function.name === 'ask_user' && tc.id === 'tc-ask')
    );
    expect(askAssistant).toBeDefined();
    expect(messages.at(-1)).toBe(askAssistant);
  });
});
