/**
 * `useDockUnifiedSearch` — grouped chat + file filtering.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDockUnifiedSearch } from '@renderer/components/dock/useDockUnifiedSearch';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { invalidateWorkspaceTreeCache } from '@renderer/lib/workspaceTreeCache';
import { vi } from 'vitest';

beforeEach(() => {
  invalidateWorkspaceTreeCache();
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Proj', path: '/proj' }],
    info: { path: '/proj', label: 'Proj' }
  } as never);
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'Alpha chat', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 },
      { id: 'c2', title: 'Beta notes', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 }
    ],
    activeIdByWorkspace: { 'ws-1': 'c1' }
  });
  window.vyotiq.workspace.listTree = vi.fn(async () =>
    ({
      entries: ['src/main.ts', 'src/utils.ts', 'lib/'],
      truncated: false,
      total: 3
    }) as never
  ) as unknown as typeof window.vyotiq.workspace.listTree;
  window.vyotiq.skills = {
    list: vi.fn(async () => [])
  } as unknown as typeof window.vyotiq.skills;
  window.vyotiq.conversations = {
    search: vi.fn(async () => [])
  } as unknown as typeof window.vyotiq.conversations;
});

describe('useDockUnifiedSearch', () => {
  it('returns empty results when not filtering', () => {
    const { result } = renderHook(() => useDockUnifiedSearch('', false, 'ws-1'));
    expect(result.current.flat).toEqual([]);
    expect(result.current.isFiltering).toBe(false);
  });

  it('groups chats and files for a query', async () => {
    const { result } = renderHook(() => useDockUnifiedSearch('src', true, 'ws-1'));
    await waitFor(() => {
      expect(result.current.files.length).toBeGreaterThan(0);
    });
    expect(result.current.files[0]?.path).toBe('src/main.ts');
    expect(result.current.flat.some((h) => h.kind === 'file')).toBe(true);
  });

  it('matches chats by title', async () => {
    useConversationsStore.setState({ activeIdByWorkspace: { 'ws-1': 'c2' } });
    const { result } = renderHook(() => useDockUnifiedSearch('beta', true, 'ws-1'));
    await waitFor(() => {
      expect(result.current.chats.some((c) => c.id === 'c2')).toBe(true);
    });
    expect(result.current.chats.find((c) => c.id === 'c2')?.title).toBe('Beta notes');
  });
});
