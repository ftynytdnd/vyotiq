/**
 * DockNavigator — flat workspace tree + bottom files panel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockNavigator } from '@renderer/components/dock/DockNavigator';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useUiStore } from '@renderer/store/useUiStore';

const WS_A = { id: 'ws-a', label: 'Codex', path: '/tmp/codex', addedAt: 0 };
const WS_B = { id: 'ws-b', label: 'antigravit', path: '/tmp/antigravit', addedAt: 1 };

const dockProps = {
  onSetWorkspacePath: () => {}
};

beforeEach(() => {
  useUiStore.setState({
    filesExpandedWorkspaces: new Set<string>(),
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  } as never);
  useWorkspaceStore.setState({
    list: [WS_A, WS_B],
    activeId: WS_A.id,
    loading: false,
    setActive: vi.fn(async () => {}),
    add: vi.fn(async () => null),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    retryReachability: vi.fn(async () => {})
  } as never);
  useConversationsStore.setState({ list: [], activeIdByWorkspace: {}, loading: false } as never);
  useChatStore.setState({ slices: {} });
});

describe('DockNavigator', () => {
  it('renders Workspaces header with add workspace and GitHub actions', () => {
    render(<DockNavigator {...dockProps} />);
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open from GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search workspace' })).toBeNull();
  });

  it('lists all workspaces as folder rows in the tree', () => {
    render(<DockNavigator {...dockProps} />);
    expect(screen.getByRole('tree', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'antigravit' })).toBeInTheDocument();
  });

  it('only expands chats under the active workspace', () => {
    render(<DockNavigator {...dockProps} />);
    const activeFolder = document.querySelector('[data-workspace-id="ws-a"]');
    const inactiveFolder = document.querySelector('[data-workspace-id="ws-b"]');
    expect(activeFolder).not.toBeNull();
    expect(inactiveFolder).not.toBeNull();
    expect((activeFolder as HTMLElement).querySelector('.vx-dock-folder-body')).not.toBeNull();
    expect((inactiveFolder as HTMLElement).querySelector('.vx-dock-folder-body')).toBeNull();
  });

  it('exposes new chat on workspace row, not a floating switcher', () => {
    useWorkspaceStore.setState({ list: [WS_A], activeId: WS_A.id } as never);
    render(<DockNavigator {...dockProps} />);
    expect(screen.queryByRole('listbox', { name: 'Switch workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New chat in Codex' })).toBeInTheDocument();
  });

  it('flows files directly below workspaces in one scroll column', () => {
    render(<DockNavigator {...dockProps} />);
    const scroll = document.querySelector('.vx-dock-nav-scroll');
    expect(scroll).not.toBeNull();
    expect(scroll?.querySelector('.vx-dock-nav-tree')).not.toBeNull();
    expect(scroll?.querySelector('.vx-dock-nav-files')).not.toBeNull();
  });

  it('renders files section in the dock scroll column', () => {
    render(<DockNavigator {...dockProps} />);
    expect(screen.getByRole('region', { name: 'Workspace files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Files/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull();
  });

  it('uses compact icon-only workspace actions in-flow', async () => {
    render(<DockNavigator {...dockProps} />);
    const activeFolder = document.querySelector('[data-workspace-id="ws-a"]');
    expect(activeFolder).not.toBeNull();
    const scope = within(activeFolder as HTMLElement);
    await userEvent.click(scope.getByRole('button', { name: 'Workspace actions' }));
    const menu = scope.getByRole('menu', { name: 'Actions for Codex' });
    expect(menu.className).toContain('vx-dock-folder-actions');
    expect(scope.getByRole('menuitem', { name: 'Reveal in Explorer' })).toBeInTheDocument();
    expect(scope.queryByRole('menuitem', { name: 'Open' })).toBeNull();
    expect(activeFolder?.querySelector('.vx-dock-folder-body')).not.toBeNull();
  });

  it('collapses the active workspace from its chevron', async () => {
    render(<DockNavigator {...dockProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Codex' }));
    expect(useUiStore.getState().collapsedWorkspaces.has(WS_A.id)).toBe(true);
  });

  it('shows workspace count in the header', () => {
    render(<DockNavigator {...dockProps} />);
    const header = screen.getByRole('heading', { name: 'Workspaces' });
    expect(header).toHaveTextContent('2');
  });

  it('activates an inactive workspace when its row is clicked', async () => {
    const setActive = vi.fn(async () => {});
    useWorkspaceStore.setState({ setActive } as never);
    render(<DockNavigator {...dockProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'antigravit' }));
    expect(setActive).toHaveBeenCalledWith(WS_B.id);
  });

  it('shows chat count on inactive workspace rows', () => {
    useConversationsStore.setState({
      list: [
        { id: 'c1', workspaceId: WS_B.id, title: 'One', archived: false, updatedAt: 0 },
        { id: 'c2', workspaceId: WS_B.id, title: 'Two', archived: false, updatedAt: 0 }
      ]
    } as never);
    render(<DockNavigator {...dockProps} />);
    const inactiveFolder = document.querySelector('[data-workspace-id="ws-b"]');
    expect(inactiveFolder).not.toBeNull();
    expect(within(inactiveFolder as HTMLElement).getByLabelText('2 chats')).toBeInTheDocument();
  });

  it('labels the files section with the active workspace when expanded', async () => {
    render(<DockNavigator {...dockProps} />);
    await userEvent.click(screen.getByRole('button', { name: /Files/ }));
    expect(screen.getByRole('button', { name: /Files/ })).toHaveTextContent('Codex');
  });

  it('remembers files panel expansion per workspace', async () => {
    const { rerender } = render(<DockNavigator {...dockProps} />);
    const filesToggle = screen.getByRole('button', { name: /Files/ });
    expect(filesToggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(filesToggle);
    expect(useUiStore.getState().filesExpandedWorkspaces.has(WS_A.id)).toBe(true);
    expect(filesToggle).toHaveAttribute('aria-expanded', 'true');

    useWorkspaceStore.setState({ activeId: WS_B.id } as never);
    useUiStore.setState({ filesExpandedWorkspaces: new Set<string>() });
    rerender(<DockNavigator {...dockProps} />);
    expect(screen.getByRole('button', { name: /Files/ })).toHaveAttribute('aria-expanded', 'false');

    useWorkspaceStore.setState({ activeId: WS_A.id } as never);
    useUiStore.setState({ filesExpandedWorkspaces: new Set([WS_A.id]) });
    rerender(<DockNavigator {...dockProps} />);
    expect(screen.getByRole('button', { name: /Files/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
