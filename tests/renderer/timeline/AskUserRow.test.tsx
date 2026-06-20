import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserRow } from '@renderer/components/timeline/rows/AskUserRow.js';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import type { TimelineEvent } from '@shared/types/chat';
import { ASK_USER_OVERLAY_MIN_QUESTIONS } from '@shared/askUser/askUserOverlay.js';

const askEvent = {
  kind: 'ask-user-prompt',
  id: 'prompt-1',
  ts: 1,
  displayText: 'Pick one\n  - Alpha (a)',
  toolCallId: 'tc-1',
  runId: 'run-1',
  payload: {
    questions: [
      {
        id: 'q1',
        prompt: 'Pick one',
        options: [{ id: 'a', label: 'Alpha' }]
      }
    ]
  }
} satisfies TimelineEvent;

describe('AskUserRow', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...INITIAL_TIMELINE_STATE,
      slices: { 'conv-1': { ...emptySlice('conv-1'), events: [askEvent] } },
      conversationId: 'conv-1',
      awaitingAskUser: true,
      events: [askEvent]
    });
  });

  it('renders inline form when pending ask_user matches this row', () => {
    const { container } = render(
      <AskUserRow
        payload={askEvent.payload}
        displayText={askEvent.displayText}
        promptEventId="prompt-1"
        toolCallId="tc-1"
        runId="run-1"
        status="pending"
      />
    );
    expect(screen.getByText('Clarifying questions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeTruthy();
    expect(container.querySelector('[data-ask-user-form]')).not.toBeNull();
    expect(container.querySelector('[data-ask-user-overlay]')).toBeNull();
  });

  it('renders nothing for multi-question overlay prompts', () => {
    const multiPayload = {
      title: 'Implementation Refinement Questions',
      questions: Array.from({ length: ASK_USER_OVERLAY_MIN_QUESTIONS }, (_, i) => ({
        id: `q${i}`,
        prompt: `Question ${i + 1}?`,
        options: [{ id: 'a', label: 'Alpha' }]
      }))
    };
    const { container } = render(
      <AskUserRow
        payload={multiPayload}
        displayText="Questions"
        promptEventId="prompt-multi"
        toolCallId="tc-1"
        runId="run-1"
        status="pending"
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
