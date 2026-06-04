import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useAskUserDraftStore, resetAskUserDraftsForTests } from '@renderer/store/askUserDraft';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

const askEvent = {
  kind: 'ask-user-prompt',
  id: 'prompt-1',
  ts: 1,
  displayText: 'Which?',
  toolCallId: 'tc-1',
  runId: 'run-1',
  status: 'pending',
  payload: {
    questions: [
      {
        id: 'q1',
        prompt: 'Which?',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' }
        ]
      }
    ]
  }
} satisfies TimelineEvent;

describe('submitPendingAskUser', () => {
  beforeEach(() => {
    resetAskUserDraftsForTests();
    useChatStore.setState({
      ...INITIAL_TIMELINE_STATE,
      slices: {
        'conv-1': {
          ...emptySlice('conv-1'),
          runId: 'run-1',
          events: [askEvent]
        }
      },
      runIdToConv: { 'run-1': 'conv-1' },
      conversationId: 'conv-1',
      runId: 'run-1',
      isProcessing: false,
      awaitingAskUser: true,
      events: [askEvent]
    });
    useAskUserDraftStore.getState().ensureDraft('prompt-1', askEvent.payload);
    useAskUserDraftStore.getState().toggleOption('prompt-1', 'q1', 'b', false);
  });

  it('merges panel drafts and calls chat IPC', async () => {
    const submitSpy = vi.spyOn(window.vyotiq.chat, 'submitAskUser');
    await useChatStore.getState().submitPendingAskUser();
    expect(submitSpy).toHaveBeenCalledOnce();
    const arg = submitSpy.mock.calls[0]![0];
    expect(arg.answers[0]?.selectedOptionIds).toEqual(['b']);
    expect(arg.toolCallId).toBe('tc-1');
  });
});
