/**
 * `RunningElsewhereHint` is self-hiding when there are no background
 * runs, surfaces the right pluralized count when there are, and the
 * "Show" button calls `focusRow(firstRunningId)`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { RunningElsewhereHint } from '@renderer/components/composer/runningElsewhere/RunningElsewhereHint';
import {
  __resetSidebarRowRegistry,
  useSidebarRowFocus
} from '@renderer/hooks/sidebar';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: 'conv-active',
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useUiStore.setState({
    sidebarOpen: false,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
  __resetSidebarRowRegistry();
});

describe('RunningElsewhereHint', () => {
  it('renders nothing when no background slices are processing', () => {
    const { container } = render(<RunningElsewhereHint />);
    expect(container.firstChild).toBeNull();
  });

  it('skips the active conversation when counting background runs', () => {
    useChatStore.setState({
      slices: {
        'conv-active': chatSliceFixture({
          conversationId: 'conv-active',
          runId: 'run-x',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { container } = render(<RunningElsewhereHint />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the singular label when one background slice is processing', () => {
    useChatStore.setState({
      slices: {
        'conv-bg-1': chatSliceFixture({
          conversationId: 'conv-bg-1',
          runId: 'run-bg-1',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    render(<RunningElsewhereHint />);
    expect(screen.getByText('1 chat streaming elsewhere')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show/i })).toBeInTheDocument();
  });

  it('renders the plural label when multiple background slices are processing', () => {
    useChatStore.setState({
      slices: {
        'conv-bg-1': chatSliceFixture({
          conversationId: 'conv-bg-1',
          runId: 'run-bg-1',
          isProcessing: true,
          runStartedAt: 1
        }),
        'conv-bg-2': chatSliceFixture({
          conversationId: 'conv-bg-2',
          runId: 'run-bg-2',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    render(<RunningElsewhereHint />);
    expect(screen.getByText('2 chats streaming elsewhere')).toBeInTheDocument();
  });

  it('opens the sidebar and scrolls the first running row into view on Show click', () => {
    useChatStore.setState({
      slices: {
        'conv-bg-1': chatSliceFixture({
          conversationId: 'conv-bg-1',
          runId: 'run-bg-1',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });

    // Register a fake row element under the running id so `focusRow`
    // resolves it and dispatches scrollIntoView.
    const RegistrationProbe = () => {
      const ref = useSidebarRowFocus('conv-bg-1');
      return <div data-testid="row" ref={ref} />;
    };
    render(<RegistrationProbe />);
    const row = screen.getByTestId('row');
    const scrollSpy = vi.fn();
    row.scrollIntoView = scrollSpy;

    render(<RunningElsewhereHint />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));

    // Sidebar opens.
    expect(useUiStore.getState().sidebarOpen).toBe(true);

    // scrollIntoView is dispatched via queueMicrotask — flush.
    return Promise.resolve().then(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });
  });
});
