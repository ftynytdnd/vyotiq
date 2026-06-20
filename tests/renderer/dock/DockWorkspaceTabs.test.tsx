/**
 * DockWorkspaceTabs — inline workspace confirmation flows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockWorkspaceTabs } from '@renderer/components/dock/DockWorkspaceTabs';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useUiStore } from '@renderer/store/useUiStore';

const WORKSPACE = { id: 'ws-1', label: 'Project', path: '/tmp/project', addedAt: 0 };

beforeEach(() => {
  useWorkspaceStore.setState({
    list: [WORKSPACE],
    activeId: WORKSPACE.id,
    info: { path: WORKSPACE.path, label: WORKSPACE.label },
    loading: false,
    setActive: vi.fn(async () => {}),
    add: vi.fn(async () => null),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    retryReachability: vi.fn(async () => {})
  } as never);
  useConversationsStore.setState({ list: [], activeIdByWorkspace: {}, loading: false } as never);
  useChatStore.setState({ slices: {} });
  useUiStore.setState({ collapsedWorkspaces: new Set<string>() });
});

describe('DockWorkspaceTabs', () => {
  it('removes a workspace through the inline keep-chats choice', async () => {
    const remove = vi.fn(async () => {});
    useWorkspaceStore.setState({ remove } as never);

    render(<DockWorkspaceTabs layout="vertical" />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
    expect(screen.getByText('Remove this workspace?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Delete chats in/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep chats' }));

    expect(remove).toHaveBeenCalledWith(WORKSPACE.id, { deleteConversations: false });
  });

  it('removes a workspace through the inline delete-chats choice', async () => {
    const remove = vi.fn(async () => {});
    useWorkspaceStore.setState({ remove } as never);

    render(<DockWorkspaceTabs layout="vertical" />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete chats' }));

    expect(remove).toHaveBeenCalledWith(WORKSPACE.id, { deleteConversations: true });
  });

  it('retries an unreachable workspace from an inline confirm row', async () => {
    const retryReachability = vi.fn(async () => {});
    useWorkspaceStore.setState({
      list: [{ ...WORKSPACE, unreachable: true }],
      retryReachability
    } as never);

    render(<DockWorkspaceTabs layout="vertical" />);

    await userEvent.click(screen.getByRole('button', { name: 'Workspace unreachable' }));
    expect(screen.getByText('Retry path?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retryReachability).toHaveBeenCalledWith(WORKSPACE.id);
  });
});
