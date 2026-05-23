/**
 * `DockSearchPopover` Enter-to-select behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockSearchPopover } from '@renderer/components/dock/DockSearchPopover';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

beforeEach(() => {
  useDockSearchStore.setState({ open: true, query: '' });
  useWorkspaceStore.setState({ activeId: 'ws-1', list: [] } as never);
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'Project map review', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' },
      { id: 'c2', title: 'Bug triage', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' },
      { id: 'c3', title: 'Test infra', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' }
    ],
    activeIdByWorkspace: {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DockSearchPopover', () => {
  it('Enter on empty query closes the search', async () => {
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats in this workspace…');
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('Escape closes the search', async () => {
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats in this workspace…');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('Enter with a non-empty query selects the top match and closes', async () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<DockSearchPopover />);
    const input = screen.getByPlaceholderText('Search chats in this workspace…');
    await userEvent.click(input);
    await userEvent.type(input, 'tri');
    await userEvent.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith('c2');
    expect(useDockSearchStore.getState().open).toBe(false);
  });
});
