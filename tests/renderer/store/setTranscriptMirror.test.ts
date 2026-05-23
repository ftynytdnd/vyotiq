/**
 * Regression: `setTranscript` must not flip the active mirror when
 * hydrating a background conversation.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    conversationId: 'conv-active',
    events: [{ kind: 'user-prompt', id: 'p1', ts: 0, content: 'active' }],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    summaries: {},
    messageOverrides: {},
    runId: null,
    isProcessing: false,
    runStartedAt: null,
    draft: 'active draft'
  });
  useChatStore.getState().setActiveConversation('conv-active');
  useChatStore.getState().setDraft('conv-active', 'active draft');
});

describe('setTranscript mirror guard', () => {
  it('does not replace the active mirror when updating another conversation slice', () => {
    useChatStore.getState().setTranscript('conv-background', []);

    expect(useChatStore.getState().conversationId).toBe('conv-active');
    expect(useChatStore.getState().draft).toBe('active draft');
    expect(useChatStore.getState().slices['conv-background']).toBeDefined();
    expect(useChatStore.getState().slices['conv-active']).toBeDefined();
  });

  it('mirrors when the updated conversation is the active one', () => {
    useChatStore.getState().setTranscript('conv-active', [
      { kind: 'user-prompt', id: 'p2', ts: 1, content: 'reloaded' }
    ]);

    expect(useChatStore.getState().conversationId).toBe('conv-active');
    expect(useChatStore.getState().events).toHaveLength(1);
    expect(useChatStore.getState().events[0]?.kind).toBe('user-prompt');
  });
});
