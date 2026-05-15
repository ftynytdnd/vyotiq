/**
 * `SidebarSearch` Phase-2 Enter-to-select behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarSearch } from '@renderer/components/sidebar/SidebarSearch';
import { useSidebarSearchStore } from '@renderer/store/useSidebarSearchStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

beforeEach(() => {
  useSidebarSearchStore.setState({ open: true, query: '' });
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'Project map review', createdAt: 0, updatedAt: 0, eventCount: 0 },
      { id: 'c2', title: 'Bug triage', createdAt: 0, updatedAt: 0, eventCount: 0 },
      { id: 'c3', title: 'Test infra', createdAt: 0, updatedAt: 0, eventCount: 0 }
    ],
    activeIdByWorkspace: {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SidebarSearch', () => {
  it('Enter on empty query closes the search', async () => {
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search chats…');
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    expect(useSidebarSearchStore.getState().open).toBe(false);
  });

  it('Escape closes the search', async () => {
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search chats…');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(useSidebarSearchStore.getState().open).toBe(false);
  });

  it('Enter with a non-empty query selects the top match and closes', async () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search chats…');
    await userEvent.click(input);
    await userEvent.type(input, 'tri');
    await userEvent.keyboard('{Enter}');
    // "Bug triage" is the only match — should be selected.
    expect(select).toHaveBeenCalledWith('c2');
    expect(useSidebarSearchStore.getState().open).toBe(false);
  });

  it('Enter with no matches leaves the search open', async () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search chats…');
    await userEvent.click(input);
    await userEvent.type(input, 'xyzzy');
    await userEvent.keyboard('{Enter}');
    expect(select).not.toHaveBeenCalled();
    expect(useSidebarSearchStore.getState().open).toBe(true);
  });

  it('matches case-insensitively', async () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<SidebarSearch />);
    const input = screen.getByPlaceholderText('Search chats…');
    await userEvent.click(input);
    await userEvent.type(input, 'PROJECT');
    await userEvent.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith('c1');
  });
});
