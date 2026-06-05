/**
 * Title bar — drag region and dock integration (context lives in the dock).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TitleBar } from '@renderer/components/titlebar/TitleBar';
import { LeftDock } from '@renderer/components/dock/LeftDock';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';

const fileActions = {
  newConversation: () => {},
  openWorkspace: () => {},
  setWorkspacePath: () => {},
  openSettings: () => {},
  quit: () => {}
};

const dockProps = { onOpenSettings: () => {} };

beforeEach(() => {
  useUiStore.setState({ dockExpanded: false, dockWidth: 260, hydrated: true });
  useDockSearchStore.setState({ open: false, query: '' });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Codex', path: '/tmp/codex' }]
  } as never);
  useConversationsStore.setState({
    list: [
      {
        id: 'c1',
        title: 'Chat',
        workspaceId: 'ws-1',
        createdAt: 0,
        updatedAt: 0,
        eventCount: 0
      }
    ],
    activeIdByWorkspace: { 'ws-1': 'c1' }
  } as never);
});

describe('TitleBar', () => {
  it('does not duplicate workspace labels in the title bar drag region', () => {
    render(<TitleBar fileActions={fileActions} />);
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
  });

  it('shows the collapsed navigation rail without duplicating labels in the title bar', () => {
    render(
      <>
        <TitleBar fileActions={fileActions} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
  });

  it('shows workspace tabs in the dock when expanded', () => {
    useUiStore.setState({ dockExpanded: true });
    render(
      <>
        <TitleBar fileActions={fileActions} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getAllByText('Codex').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tablist', { name: 'Workspaces' })).toBeInTheDocument();
  });
});
