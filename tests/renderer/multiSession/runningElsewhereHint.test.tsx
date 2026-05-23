/**
 * `RunningElsewhereHint` is self-hiding when there are no background
 * runs, surfaces the right pluralized count when there are, and the
 * "Show" button calls `focusRow(firstRunningId)`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { RunningElsewhereHint } from '@renderer/components/composer/runningElsewhere/RunningElsewhereHint';
import {
  __resetChatRowRegistry,
  useChatRowFocus
} from '@renderer/hooks/chat/useChatRowFocus';
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
    dockExpanded: false,
    dockWidth: 260,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
  useWorkspaceStore.setState({ activeId: 'ws-active', list: [] } as never);
  useConversationsStore.setState({ list: [], activeIdByWorkspace: {} } as never);
  __resetChatRowRegistry();
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

  it('expands the dock and scrolls the first running row into view on Show click', async () => {
    useWorkspaceStore.setState({
      activeId: 'ws-active',
      list: [{ id: 'ws-active', label: 'Active', path: '/a' }]
    } as never);
    useConversationsStore.setState({
      list: [
        {
          id: 'conv-bg-1',
          title: 'Background',
          workspaceId: 'ws-active',
          createdAt: 0,
          updatedAt: 0,
          eventCount: 0
        }
      ],
      activeIdByWorkspace: { 'ws-active': 'conv-active' }
    } as never);
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
      const ref = useChatRowFocus('conv-bg-1');
      return <div data-testid="row" ref={ref} />;
    };
    render(
      <>
        <RegistrationProbe />
        <RunningElsewhereHint />
      </>
    );
    const row = screen.getByTestId('row');
    const scrollSpy = vi.fn();
    row.scrollIntoView = scrollSpy;

    fireEvent.click(screen.getByRole('button', { name: /show/i }));

    // Dock expands.
    expect(useUiStore.getState().dockExpanded).toBe(true);

    // scrollIntoView is deferred until after navigation + dock expand re-render.
    await vi.waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
    });
  });

  it('Show switches workspace and clears collapsed state for cross-workspace runs', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      activeId: 'ws-active',
      list: [
        { id: 'ws-active', label: 'Active', path: '/a' },
        { id: 'ws-other', label: 'Other', path: '/b' }
      ],
      setActive
    } as never);
    useConversationsStore.setState({
      list: [
        {
          id: 'conv-bg-1',
          title: 'Background',
          workspaceId: 'ws-other',
          createdAt: 0,
          updatedAt: 0,
          eventCount: 0
        }
      ],
      activeIdByWorkspace: { 'ws-active': 'conv-active', 'ws-other': 'conv-other' },
      select
    } as never);
    useUiStore.setState({ collapsedWorkspaces: new Set(['ws-other']) });
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
    fireEvent.click(screen.getByRole('button', { name: /show/i }));

    await vi.waitFor(() => {
      expect(setActive).toHaveBeenCalledWith('ws-other');
      expect(select).toHaveBeenCalledWith('conv-bg-1');
      expect(useUiStore.getState().collapsedWorkspaces.has('ws-other')).toBe(false);
    });
  });
});
