/**
 * Title bar breadcrumb — workspace › chat context in the drag region.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('TitleBar breadcrumb', () => {
  it('shows workspace › chat breadcrumb in the title bar drag region', () => {
    render(
      <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
    );
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Codex').closest('.vx-titlebar-breadcrumb')).toHaveTextContent(
      'Codex › Chat'
    );
  });

  it('shows workspace context in the title bar when dock is collapsed', () => {
    render(
      <>
        <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
  });

  it('shows workspace tabs in the dock when expanded', () => {
    useUiStore.setState({ dockExpanded: true });
    render(
      <>
        <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getAllByText('Codex').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tablist', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('opens keyboard shortcuts help from the title bar', () => {
    render(
      <TitleBar fileActions={fileActions} viewActions={viewActions} onOpenSettings={() => {}} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Toggle navigation dock')).toBeInTheDocument();
  });
});
