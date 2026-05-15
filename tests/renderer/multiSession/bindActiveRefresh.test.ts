/**
 * `useConversationsStore.bindActive` only fires `conversations.list`
 * when there's something the renderer might learn from it:
 *
 *   - the bound id isn't in the cached list yet (auto-create path), or
 *   - the persisted title is still the placeholder ("New conversation"),
 *     meaning main may have just derived a real one from the prompt.
 *
 * Re-sending in an already-titled chat must be zero-IPC.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useWorkspaceStore.setState({
    list: [{ id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 }],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
});

describe('useConversationsStore.bindActive — refresh gating', () => {
  it('does NOT call conversations.list when binding an already-titled chat', () => {
    useConversationsStore.setState({
      list: [
        { id: 'conv-A', title: 'My chat', createdAt: 0, updatedAt: 0, eventCount: 1, workspaceId: 'ws-A' }
      ],
      activeIdByWorkspace: { 'ws-A': 'conv-A' },
      hydratedIds: new Set<string>(['conv-A']),
      loading: false
    });
    const listSpy = vi.fn(async () => []);
    window.vyotiq.conversations.list = listSpy as never;

    useConversationsStore.getState().bindActive('conv-A', 'ws-A');

    expect(listSpy).not.toHaveBeenCalled();
  });

  it('DOES call conversations.list when the bound id is unknown (auto-create path)', () => {
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: {},
      hydratedIds: new Set<string>(),
      loading: false
    });
    const listSpy = vi.fn(async () => []);
    window.vyotiq.conversations.list = listSpy as never;

    useConversationsStore.getState().bindActive('conv-fresh', 'ws-A');

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('DOES call conversations.list when the persisted title is still the placeholder', () => {
    useConversationsStore.setState({
      list: [
        {
          id: 'conv-A',
          title: 'New conversation',
          createdAt: 0,
          updatedAt: 0,
          eventCount: 0,
          workspaceId: 'ws-A'
        }
      ],
      activeIdByWorkspace: {},
      hydratedIds: new Set<string>(),
      loading: false
    });
    const listSpy = vi.fn(async () => []);
    window.vyotiq.conversations.list = listSpy as never;

    useConversationsStore.getState().bindActive('conv-A', 'ws-A');

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('still updates the slot map even when refresh is skipped', () => {
    useConversationsStore.setState({
      list: [
        { id: 'conv-A', title: 'My chat', createdAt: 0, updatedAt: 0, eventCount: 1, workspaceId: 'ws-A' }
      ],
      activeIdByWorkspace: {},
      hydratedIds: new Set<string>(),
      loading: false
    });
    const listSpy = vi.fn(async () => []);
    window.vyotiq.conversations.list = listSpy as never;

    useConversationsStore.getState().bindActive('conv-A', 'ws-A');

    expect(listSpy).not.toHaveBeenCalled();
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('conv-A');
    expect(useConversationsStore.getState().hydratedIds.has('conv-A')).toBe(true);
  });
});
