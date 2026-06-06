/**
 * ComposerStatusStrip — ask-user and off-tail hints.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    isProcessing: false,
    events: []
  });
  useTimelineUiStore.setState({ timelineAtTail: true });
});

describe('ComposerStatusStrip', () => {
  it('shows off-tail hint with readable Latest label', () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });
    useTimelineUiStore.setState({ timelineAtTail: false });

    render(<ComposerStatusStrip />);

    expect(screen.getByText(/Scroll down or use/i)).toBeInTheDocument();
    const latestButton = screen.getByRole('button', { name: /Jump to latest messages/i });
    expect(latestButton.className).toContain('vx-jump-to-latest-label');
  });

  it('requests scroll-to-tail when Latest is clicked', async () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });
    useTimelineUiStore.setState({ timelineAtTail: false, scrollToTailRequest: 0 });

    const before = useTimelineUiStore.getState().scrollToTailRequest;
    render(<ComposerStatusStrip />);
    screen.getByRole('button', { name: /Jump to latest messages/i }).click();
    expect(useTimelineUiStore.getState().scrollToTailRequest).toBe(before + 1);
  });

  it('shows ask-user hint when pending', () => {
    render(
      <ComposerStatusStrip
        pendingAskUser={{
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          payload: { title: 'Choose one', questions: [] }
        }}
      />
    );

    expect(screen.getByText(/Reply needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose one/i)).toBeInTheDocument();
  });

  it('does not show run phase labels', () => {
    useChatStore.setState({
      isProcessing: true,
      runStartedAt: Date.now() - 5000,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: Date.now(),
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    } as never);

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/Exploring/i)).toBeNull();
  });
});
