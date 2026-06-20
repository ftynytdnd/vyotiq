import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserOverlayHost } from '@renderer/components/timeline/askUser/AskUserOverlayHost.js';
import { useChatStore } from '@renderer/store/useChatStore';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';
import { ASK_USER_OVERLAY_MIN_QUESTIONS } from '@shared/askUser/askUserOverlay.js';

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

const hostGateEvent = {
  ...askEvent,
  id: 'host-gate-1',
  source: 'host-report-gate' as const,
  payload: {
    title: 'Generate HTML report',
    questions: [{ id: 'q1', prompt: 'Generate report?', options: [{ id: 'yes', label: 'Yes' }] }]
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

  it('does not render overlay for single-question agent ask_user (inline in timeline)', () => {
    render(<AskUserOverlayHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders floating overlay for multi-question agent ask_user', () => {
    const multiEvent = {
      ...askEvent,
      id: 'prompt-multi',
      displayText: 'Refinement',
      payload: {
        title: 'Implementation Refinement Questions',
        questions: Array.from({ length: ASK_USER_OVERLAY_MIN_QUESTIONS }, (_, i) => ({
          id: `q${i}`,
          prompt: `Question ${i + 1}?`,
          options: [{ id: 'a', label: 'Alpha' }]
        }))
      }
    } satisfies TimelineEvent;
    useChatStore.setState({
      slices: { 'conv-1': { ...emptySlice('conv-1'), events: [multiEvent] } },
      events: [multiEvent]
    });
    render(<AskUserOverlayHost />);
    expect(screen.getByRole('dialog', { name: 'Implementation Refinement Questions' })).toBeTruthy();
  });

  it('renders floating overlay for host report gate', () => {
    useChatStore.setState({
      slices: { 'conv-1': { ...emptySlice('conv-1'), events: [hostGateEvent] } },
      events: [hostGateEvent]
    });
    render(<AskUserOverlayHost />);
    expect(screen.getByRole('dialog', { name: 'Generate HTML report' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('hides overlay when the prompt is already submitted', () => {
    useChatStore.setState({
      slices: {
        'conv-1': {
          ...emptySlice('conv-1'),
          events: [{ ...hostGateEvent, status: 'submitted' }]
        }
      },
      conversationId: 'conv-1',
      awaitingAskUser: true,
      events: [{ ...hostGateEvent, status: 'submitted' }]
    });
    render(<AskUserOverlayHost />);
    expect(screen.queryByRole('dialog', { name: 'Generate HTML report' })).toBeNull();
  });
});
