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
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useChatStore } from '@renderer/store/useChatStore';

const fileActions = {
  newConversation: () => {},
  openWorkspace: () => {},
  setWorkspacePath: () => {},
  openSettings: () => {},
  quit: () => {}
};

const dockProps = {
  onSetWorkspacePath: () => {}
};

const titlebarProps = {
  fileActions,
  onBackFromSettings: () => {}
};

beforeEach(() => {
  useUiStore.setState({ dockExpanded: false, dockWidth: 260, hydrated: true });
  useDockSearchStore.setState({ open: false, query: '' });
  useChatStore.setState({ events: [{ type: 'user-prompt', id: 'e1' }] } as never);
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
  it('shows interactive workspace context when the dock is collapsed and chat has messages', () => {
    render(<TitleBar {...titlebarProps} />);
    expect(screen.getByRole('navigation', { name: 'Workspace context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat Chat' })).toBeInTheDocument();
  });

  it('does not show chat context in the title bar when the dock is expanded', () => {
    useUiStore.setState({ dockExpanded: true });
    const { container } = render(
      <>
        <TitleBar {...titlebarProps} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(container.querySelector('.vx-titlebar .vx-titlebar-breadcrumb')).toBeNull();
    expect(screen.getByRole('tree', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('shows expand navigation in titlebar chrome when dock is collapsed', () => {
    render(
      <>
        <TitleBar {...titlebarProps} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
  });

  it('shows workspace tabs in the dock when expanded', () => {
    useUiStore.setState({ dockExpanded: true });
    render(
      <>
        <TitleBar {...titlebarProps} />
        <LeftDock {...dockProps} />
      </>
    );
    expect(screen.getAllByText('Codex').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tree', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('shows a settings breadcrumb in the title bar when settings is open', () => {
    useAppViewStore.setState({ view: 'settings', settingsSection: 'models-api', aboutOpen: false });
    render(<TitleBar {...titlebarProps} />);
    expect(screen.getByText('Models & API')).toBeInTheDocument();
  });

  it('shows a three-level breadcrumb for agent behavior subsections', () => {
    useAppViewStore.setState({ view: 'settings', settingsSection: 'agent-behavior', aboutOpen: false });
    useSettingsStore.setState({
      settings: { ui: { lastAgentBehaviorSection: 'harness' } }
    } as never);
    render(<TitleBar {...titlebarProps} />);
    expect(screen.getByText('Agent behavior')).toBeInTheDocument();
    expect(screen.getByText('Harness')).toBeInTheDocument();
  });
});
