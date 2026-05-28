/**
 * Title bar workspace chip — context lives in the left dock instead.
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
  openCheckpoints: () => {},
  openContextInspector: () => {},
  quit: () => {}
};

const viewActions = {
  openContextInspector: () => {}
};

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

describe('TitleBar workspace chip', () => {
  it('does not duplicate the workspace label — context lives in the dock', () => {
    render(
      <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
    );
    expect(screen.queryByText('Codex')).toBeNull();
  });

  it('shows workspace context in the dock when collapsed', () => {
    render(<LeftDock />);
    expect(screen.getByRole('button', { name: /Expand navigation.*Codex/i })).toBeInTheDocument();
    expect(screen.getByText('Cod')).toBeInTheDocument();
  });

  it('shows workspace tabs in the dock when expanded', () => {
    useUiStore.setState({ dockExpanded: true });
    render(
      <>
        <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
        <LeftDock />
      </>
    );
    expect(screen.queryByText('Codex')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspaces' })).toBeInTheDocument();
  });
});
