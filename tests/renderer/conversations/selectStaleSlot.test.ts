/**
 * Stale persisted slots must not trigger JSONL reads for deleted conversations.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

const meta = (id: string) => ({
  id,
  title: id,
  createdAt: 0,
  updatedAt: 0,
  eventCount: 1,
  workspaceId: 'ws-test'
});

beforeEach(() => {
  useWorkspaceStore.setState({
    list: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }],
    activeId: 'ws-test',
    info: { path: '/tmp/ws', label: 'ws' },
    loading: false
  });
  window.vyotiq.settings.set = vi.fn(async (patch: object) => patch) as never;
  window.vyotiq.conversations.readTail = vi.fn(async () => null) as never;
});

describe('useConversationsStore.select — stale slot', () => {
  it('clears a persisted slot and skips IPC when the id is absent from the catalogue', async () => {
    useConversationsStore.setState({
      list: [meta('conv-live')],
      activeIdByWorkspace: { 'ws-test': 'conv-deleted' },
      hydratedIds: new Set<string>(),
      loading: false,
      activeSlotsHydrated: true,
      selecting: false
    });

    await useConversationsStore.getState().select('conv-deleted');

    expect(window.vyotiq.conversations.readTail).not.toHaveBeenCalled();
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-test']).toBeNull();
    expect(window.vyotiq.settings.set).toHaveBeenCalled();
  });

  it('still reads when the catalogue is empty (boot race before first list fetch)', async () => {
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: { 'ws-test': 'conv-pending' },
      hydratedIds: new Set<string>(),
      loading: false,
      activeSlotsHydrated: true,
      selecting: false
    });

    await useConversationsStore.getState().select('conv-pending');

    expect(window.vyotiq.conversations.readTail).toHaveBeenCalledWith('conv-pending');
  });
});
