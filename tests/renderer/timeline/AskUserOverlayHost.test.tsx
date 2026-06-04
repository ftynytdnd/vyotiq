import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserOverlayHost } from '@renderer/components/timeline/askUser/AskUserOverlayHost.js';
import { useChatStore } from '@renderer/store/useChatStore';
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
  payload: {
    questions: [{ id: 'q1', prompt: 'Which?', options: [{ id: 'a', label: 'A' }] }]
  }
} satisfies TimelineEvent;

describe('AskUserOverlayHost', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...INITIAL_TIMELINE_STATE,
      slices: { 'conv-1': { ...emptySlice('conv-1'), events: [askEvent] } },
      conversationId: 'conv-1',
      awaitingAskUser: true,
      events: [askEvent]
    });
  });

  it('renders floating overlay with submit control when awaiting ask_user', () => {
    render(<AskUserOverlayHost />);
    expect(screen.getByRole('form', { name: 'Clarifying questions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeTruthy();
  });

  it('hides overlay when the prompt is already submitted', () => {
    useChatStore.setState({
      slices: {
        'conv-1': {
          ...emptySlice('conv-1'),
          events: [{ ...askEvent, status: 'submitted' }]
        }
      },
      conversationId: 'conv-1',
      awaitingAskUser: true,
      events: [{ ...askEvent, status: 'submitted' }]
    });
    render(<AskUserOverlayHost />);
    expect(screen.queryByRole('form', { name: 'Clarifying questions' })).toBeNull();
  });
});
