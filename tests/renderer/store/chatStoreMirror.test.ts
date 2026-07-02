/**
 * `mirrorOf` — projects slice fields onto the active store mirror.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { mirrorOf } from '@renderer/store/chatStoreMirror';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { useChatStore } from '@renderer/store/useChatStore';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    conversationId: null,
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    toolCacheHint: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('mirrorOf', () => {
  it('copies lastUserPromptId from the active slice', () => {
    const slice = emptySlice('conv-mirror-1');
    slice.lastUserPromptId = 'prompt-1';
    const mirror = mirrorOf(slice);
    expect(mirror.lastUserPromptId).toBe('prompt-1');
  });

  it('copies toolCacheHint from the active slice', () => {
    const slice = emptySlice('conv-mirror-hint');
    slice.toolCacheHint = 'Replayed from cache';
    const mirror = mirrorOf(slice);
    expect(mirror.toolCacheHint).toBe('Replayed from cache');
  });

  it('normalizes undefined toolCacheHint to null', () => {
    const slice = emptySlice('conv-mirror-hint-null');
    const mirror = mirrorOf(slice);
    expect(mirror.toolCacheHint).toBeNull();
  });

  it('copies followUps from the active slice', () => {
    const slice = emptySlice('conv-mirror-2');
    slice.followUps = {
      steering: [
        {
          id: 'fu-1',
          kind: 'steering',
          prompt: 'steer',
          createdAt: 1,
          source: 'user'
        }
      ],
      queued: []
    };
    const mirror = mirrorOf(slice);
    expect(mirror.followUps.steering).toHaveLength(1);
    expect(mirror.followUps.steering[0]?.prompt).toBe('steer');
  });
});

describe('toolCacheHint active mirror', () => {
  it('reflects slice hint after setActiveConversation', () => {
    const sliceA = emptySlice('conv-a');
    sliceA.toolCacheHint = 'Cached read result';
    const sliceB = emptySlice('conv-b');
    sliceB.toolCacheHint = null;

    useChatStore.setState({
      slices: { 'conv-a': sliceA, 'conv-b': sliceB },
      conversationId: 'conv-a',
      toolCacheHint: 'Cached read result'
    });

    useChatStore.getState().setActiveConversation('conv-b');
    expect(useChatStore.getState().toolCacheHint).toBeNull();

    useChatStore.getState().setActiveConversation('conv-a');
    expect(useChatStore.getState().toolCacheHint).toBe('Cached read result');
  });
});
