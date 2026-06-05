/**
 * `DockSearchPopover` keyboard and unified-search behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockSearchPopover } from '@renderer/components/dock/DockSearchPopover';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { invalidateWorkspaceTreeCache } from '@renderer/lib/workspaceTreeCache';

beforeEach(() => {
  invalidateWorkspaceTreeCache();
  useDockSearchStore.setState({ open: true, query: '' });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Proj', path: '/proj' }],
    info: { path: '/proj', label: 'Proj' }
  } as never);
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'Project map review', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' },
      { id: 'c2', title: 'Bug triage', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' },
      { id: 'c3', title: 'Test infra', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' }
    ],
    activeIdByWorkspace: {}
  });
  window.vyotiq.workspace.listTree = vi.fn(async () =>
    ({
      entries: ['src/main.ts', 'README.md'],
      truncated: false,
      total: 2
    }) as never
  ) as unknown as typeof window.vyotiq.workspace.listTree;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DockSearchPopover', () => {
  it('Enter on empty query closes the search', async () => {
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats and files…');
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('Escape closes the search', async () => {
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats and files…');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('Enter with a non-empty query selects the top chat match and closes', async () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats and files…');
    await userEvent.click(input);
    await userEvent.type(input, 'tri');
    await userEvent.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith('c2');
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('shows grouped Chats and Files results', async () => {
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats and files…');
    await userEvent.type(input, 'main');
    await waitFor(() => {
      expect(screen.getByText('Files')).toBeInTheDocument();
    });
    expect(screen.getByText('src/main.ts')).toBeInTheDocument();
  });
});
