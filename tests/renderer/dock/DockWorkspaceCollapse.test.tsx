/**
 * Workspace chat-list collapse in the left dock.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DockChatStrip } from '@renderer/components/dock/DockChatStrip';
import { useUiStore } from '@renderer/store/useUiStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useUiStore.setState({
    dockExpanded: true,
    dockWidth: 260,
    collapsedWorkspaces: new Set(['ws-1']),
    hydrated: true
  });
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'Run A', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 },
      { id: 'c2', title: 'Run B', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 }
    ],
    activeIdByWorkspace: { 'ws-1': 'c1' },
    loading: false
  } as never);
  useChatStore.setState({
    slices: {
      'c1': chatSliceFixture({ conversationId: 'c1', runId: 'run-a', isProcessing: true, runStartedAt: 1 }),
      'c2': chatSliceFixture({ conversationId: 'c2', runId: 'run-b', isProcessing: true, runStartedAt: 2 })
    }
  });
});

describe('DockChatStrip collapsed workspace', () => {
  it('shows all running chats when collapsed', () => {
    render(<DockChatStrip workspaceId="ws-1" />);
    expect(screen.getByRole('tab', { name: /Run A/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Run B/i })).toBeInTheDocument();
    expect(screen.getByText('2 chats hidden')).toBeInTheDocument();
  });

  it('Expand clears collapsed state for the workspace', () => {
    render(<DockChatStrip workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(useUiStore.getState().collapsedWorkspaces.has('ws-1')).toBe(false);
  });
});
