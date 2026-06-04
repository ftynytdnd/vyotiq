import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

describe('useChatStore ask_user pause/resume', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...INITIAL_TIMELINE_STATE,
      slices: { 'conv-1': { ...emptySlice('conv-1'), runId: 'run-1' } },
      runIdToConv: { 'run-1': 'conv-1' },
      conversationId: 'conv-1',
      runId: 'run-1',
      isProcessing: true,
      awaitingAskUser: false
    });
  });

  it('pauseForAskUser clears isProcessing and latches awaitingAskUser', () => {
    useChatStore.getState().pauseForAskUser('run-1');
    const s = useChatStore.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.awaitingAskUser).toBe(true);
    expect(s.runId).toBe('run-1');
  });

  it('submitAskUser calls chat IPC and resumes processing', async () => {
    useChatStore.getState().pauseForAskUser('run-1');
    const submitSpy = vi.spyOn(window.vyotiq.chat, 'submitAskUser');

    await useChatStore.getState().submitAskUser({
      runId: 'run-1',
      conversationId: 'conv-1',
      promptEventId: 'prompt-1',
      toolCallId: 'tc-1',
      payload: {
        questions: [{ id: 'q1', prompt: 'Pick', options: [{ id: 'a', label: 'A' }] }]
      },
      answers: [{ questionId: 'q1', selectedOptionIds: ['a'] }]
    });

    expect(submitSpy).toHaveBeenCalledOnce();
    expect(useChatStore.getState().isProcessing).toBe(true);
    expect(useChatStore.getState().awaitingAskUser).toBe(false);
  });
});
