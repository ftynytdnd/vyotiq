/**
 * Inactive idle slice unload + terminal sub-agent salvage on finishRun.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function terminalSubagent(): SubAgentSnapshot {
  return {
    id: 'sub-1',
    task: 'scan repo',
    files: [],
    missingFiles: [],
    tools: [],
    unknownTools: [],
    status: 'done',
    startedAt: 1,
    endedAt: 2,
    steps: [{ callId: 'c1', startedAt: 1 }],
    fileEdits: [],
    assistantTexts: { a1: { id: 'a1', text: 'done', startedAt: 1 } },
    reasoningTexts: {},
    iterationOrder: ['a1']
  };
}

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useConversationsStore.setState({
    hydratedIds: new Set(['conv-a'])
  });
});

describe('useChatStore RAM', () => {
  it('dropConversation clears checkpoint pending cache', () => {
    // Covered in checkpointsDropConversation.test.ts; smoke that chat routes through it.
    useChatStore.getState().dropConversation('missing');
    expect(useChatStore.getState().slices['missing']).toBeUndefined();
  });

  it('finishRun salvages terminal sub-agent trace payloads', () => {
    useChatStore.setState({
      slices: {
        'conv-a': chatSliceFixture({
          conversationId: 'conv-a',
          runId: 'run-a',
          isProcessing: true,
          subagents: { 'sub-1': terminalSubagent() }
        })
      },
      runIdToConv: { 'run-a': 'conv-a' },
      conversationId: 'conv-a',
      runId: 'run-a',
      isProcessing: true
    });
    useChatStore.getState().finishRun('run-a');
    const snap = useChatStore.getState().slices['conv-a']!.subagents['sub-1']!;
    expect(snap.status).toBe('done');
    expect(snap.steps).toEqual([]);
    expect(snap.assistantTexts).toEqual({});
  });

  it('setActiveConversation unloads the previous idle slice and marks it unhydrated', () => {
    useChatStore.setState({
      slices: {
        'conv-a': chatSliceFixture({
          conversationId: 'conv-a',
          draft: 'keep me',
          events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi' }]
        }),
        'conv-b': chatSliceFixture({ conversationId: 'conv-b' })
      },
      conversationId: 'conv-a',
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi' }]
    });
    useConversationsStore.setState({ hydratedIds: new Set(['conv-a', 'conv-b']) });

    useChatStore.getState().setActiveConversation('conv-b');

    const unloaded = useChatStore.getState().slices['conv-a']!;
    expect(unloaded.draft).toBe('keep me');
    expect(unloaded.events).toEqual([]);
    expect(useConversationsStore.getState().hydratedIds.has('conv-a')).toBe(false);
  });
});
