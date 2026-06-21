/**
 * Regression: `setActiveConversation` must mirror per-slice `followUps`
 * onto the top-level store (via `mirrorOf`). Without this, switching chats
 * leaves the follow-up tray showing the prior conversation's queue.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { emptySlice } from '@renderer/store/chatStoreTypes';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    ...emptySlice(''),
    conversationId: null,
    followUps: { steering: [], queued: [] }
  });
});

describe('setActiveConversation followUps mirror', () => {
  it('replaces top-level followUps when switching conversations', () => {
    const sliceA = emptySlice('conv-a');
    sliceA.followUps = {
      steering: [
        {
          id: 'fu-a',
          kind: 'steering',
          prompt: 'Steer A',
          createdAt: 1,
          source: 'user'
        }
      ],
      queued: []
    };
    const sliceB = emptySlice('conv-b');
    sliceB.followUps = {
      steering: [
        {
          id: 'fu-b',
          kind: 'steering',
          prompt: 'Steer B',
          createdAt: 2,
          source: 'user'
        }
      ],
      queued: []
    };

    useChatStore.setState({
      slices: { 'conv-a': sliceA, 'conv-b': sliceB },
      conversationId: 'conv-a',
      followUps: sliceA.followUps
    });

    useChatStore.getState().setActiveConversation('conv-a');
    expect(useChatStore.getState().followUps.steering[0]?.prompt).toBe('Steer A');

    useChatStore.getState().setActiveConversation('conv-b');
    expect(useChatStore.getState().followUps.steering[0]?.prompt).toBe('Steer B');
    expect(useChatStore.getState().followUps.steering).toHaveLength(1);
  });

  it('clears stale followUps when switching to a slice with an empty queue', () => {
    const sliceA = emptySlice('conv-a');
    sliceA.followUps = {
      steering: [
        {
          id: 'fu-a',
          kind: 'steering',
          prompt: 'Steer A',
          createdAt: 1,
          source: 'user'
        }
      ],
      queued: []
    };
    const sliceB = emptySlice('conv-b');

    useChatStore.setState({
      slices: { 'conv-a': sliceA, 'conv-b': sliceB },
      conversationId: 'conv-a',
      followUps: sliceA.followUps
    });

    useChatStore.getState().setActiveConversation('conv-b');
    expect(useChatStore.getState().followUps.steering).toHaveLength(0);
    expect(useChatStore.getState().followUps.queued).toHaveLength(0);
  });
});
