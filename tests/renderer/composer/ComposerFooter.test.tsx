/**
 * ComposerStatusStrip — ask-user reply hint only.
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
  it('renders nothing when scrolled off tail with no ask-user', () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });
    useTimelineUiStore.setState({ timelineAtTail: false });

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
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
});
