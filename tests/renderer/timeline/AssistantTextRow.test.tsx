/**
 * AssistantTextRow — prose eyebrow + action strip contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AssistantTextRow } from '@renderer/components/timeline/rows/AssistantTextRow';
import { AGENT_NAME } from '@shared/constants.js';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

afterEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: null,
    isProcessing: false,
    assistantTexts: {},
    lastUserPromptContent: undefined
  });
});

describe('AssistantTextRow', () => {
  it('renders flush markdown with no surface chrome and an a11y label', () => {
    useChatStore.setState({
      assistantTexts: {
        'msg-1': { id: 'msg-1', text: 'Hello **world**', done: true }
      }
    });

    const { container, queryByText } = render(
      <AssistantTextRow id="msg-1" model={null} />
    );

    // May 2026 restyle: the visible AGENT_NAME eyebrow was removed in
    // favor of an a11y label on the row root. The prose still renders
    // through the markdown body.
    expect(queryByText(AGENT_NAME)).toBeNull();
    expect(container.querySelector('[data-row-kind="assistant-text"]')?.getAttribute('aria-label'))
      .toBe(`${AGENT_NAME} response`);
    expect(container.querySelector('.vyotiq-md')).not.toBeNull();
    expect(container.querySelector('.surface-shell')).toBeNull();
    // Response lane background was dropped — the wrapper carries no
    // bg-surface-overlay tint anymore.
    expect(container.firstElementChild?.className ?? '').not.toMatch(/bg-surface-overlay/);
    expect(container.firstElementChild?.className ?? '').not.toMatch(/rounded-inner/);
  });

  it('shows a streaming skeleton while prose is empty and still in flight', () => {
    useChatStore.setState({
      assistantTexts: {
        'msg-stream': { id: 'msg-stream', text: '', done: false, startedAt: Date.now() }
      }
    });

    const { container } = render(
      <AssistantTextRow id="msg-stream" model={null} />
    );

    // a11y still labels the row as the agent's response surface.
    expect(container.querySelector('[data-row-kind="assistant-text"]')?.getAttribute('aria-label'))
      .toBe(`${AGENT_NAME} response`);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(container.querySelector('.vyotiq-md')).toBeNull();
  });

  it('exposes copy action when eligible', () => {
    useChatStore.setState({
      conversationId: 'c-1',
      isProcessing: false,
      lastUserPromptContent: 'prior prompt',
      assistantTexts: {
        'msg-1': { id: 'msg-1', text: 'Done.', done: true }
      },
      send: vi.fn()
    });

    const { getByRole, queryByRole } = render(
      <AssistantTextRow
        id="msg-1"
        model={{ providerId: 'p-1', modelId: 'gpt-test' }}
      />
    );

    expect(getByRole('button', { name: /copy/i })).not.toBeNull();
    expect(queryByRole('button', { name: /regenerate/i })).toBeNull();
  });

  it('renders very long settled replies in full (no show-more fold)', () => {
    const longBody = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with enough text to wrap.`).join('\n\n');
    useChatStore.setState({
      assistantTexts: {
        'msg-long': { id: 'msg-long', text: longBody, done: true }
      }
    });

    const { queryByRole, container } = render(<AssistantTextRow id="msg-long" model={null} />);
    expect(queryByRole('button', { name: /show more/i })).toBeNull();
    expect(container.querySelector('.vyotiq-md')).not.toBeNull();
    expect(container.textContent).toContain('Paragraph 119');
  });
});
