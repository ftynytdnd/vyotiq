import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ConversationMeta } from '@shared/types/chat.js';
import {
  __resetLandingCreateForTests,
  useConversationsStore
} from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

function meta(
  partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id' | 'workspaceId'>
): ConversationMeta {
  return {
    title: 'T',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 1,
    ...partial
  };
}

describe('restoreWorkspaceSession / ensureLandingConversation', () => {
  const select = vi.fn(async () => undefined);
  const newConversation = vi.fn(async () =>
    meta({ id: 'conv-created', workspaceId: 'ws-1', updatedAt: 1 })
  );

  beforeEach(() => {
    __resetLandingCreateForTests();
    select.mockClear();
    newConversation.mockClear();
    useChatStore.setState({
      slices: {},
      runIdToConv: {},
      events: [],
      conversationId: null,
      runId: null,
      isProcessing: false
    } as never);
    useWorkspaceStore.setState({
      list: [{ id: 'ws-1', path: '/tmp', label: 'A', addedAt: 0 }],
      activeId: 'ws-1',
      info: { path: '/tmp', label: 'A' },
      loading: false
    } as never);
    useConversationsStore.setState({
      list: [
        meta({ id: 'conv-old', workspaceId: 'ws-1', updatedAt: 1 }),
        meta({ id: 'conv-newest', workspaceId: 'ws-1', updatedAt: 99 })
      ],
      activeIdByWorkspace: { 'ws-1': 'conv-stale' },
      hydratedIds: new Set<string>(),
      loading: false,
      activeSlotsHydrated: true,
      selecting: false,
      select,
      newConversation
    } as never);
  });

  it('restoreWorkspaceSession selects newest chat when slot is stale', async () => {
    await useConversationsStore.getState().restoreWorkspaceSession('ws-1');
    expect(select).toHaveBeenCalledWith('conv-newest');
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('restoreWorkspaceSession persists slot without IPC when already hydrated', async () => {
    useConversationsStore.setState({
      activeIdByWorkspace: { 'ws-1': 'conv-stale' },
      hydratedIds: new Set(['conv-newest'])
    } as never);
    useChatStore.setState({ conversationId: 'conv-newest' } as never);

    await useConversationsStore.getState().restoreWorkspaceSession('ws-1');

    expect(select).not.toHaveBeenCalled();
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-1']).toBe('conv-newest');
  });

  it('restoreWorkspaceSession keeps a freshly created empty chat instead of falling back', async () => {
    const freshGhost = meta({
      id: 'conv-fresh',
      workspaceId: 'ws-1',
      updatedAt: 500,
      eventCount: 0
    });
    useConversationsStore.setState({
      list: [
        meta({ id: 'conv-old', workspaceId: 'ws-1', updatedAt: 100 }),
        freshGhost
      ],
      activeIdByWorkspace: { 'ws-1': 'conv-fresh' },
      hydratedIds: new Set(['conv-fresh'])
    } as never);
    useChatStore.setState({ conversationId: 'conv-fresh' } as never);

    await useConversationsStore.getState().restoreWorkspaceSession('ws-1');

    expect(select).not.toHaveBeenCalled();
    expect(useChatStore.getState().conversationId).toBe('conv-fresh');
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-1']).toBe('conv-fresh');
  });

  it('ensureLandingConversation is a no-op when a restorable chat exists', async () => {
    const result = await useConversationsStore.getState().ensureLandingConversation('ws-1');
    expect(result).toBeNull();
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('ensureLandingConversation keeps an existing ghost slot instead of creating another', async () => {
    useConversationsStore.setState({
      list: [
        meta({ id: 'ghost-1', workspaceId: 'ws-1', updatedAt: 1, eventCount: 0 }),
        meta({ id: 'ghost-2', workspaceId: 'ws-1', updatedAt: 2, eventCount: 0 })
      ],
      activeIdByWorkspace: { 'ws-1': 'ghost-2' }
    } as never);

    const result = await useConversationsStore.getState().ensureLandingConversation('ws-1');

    expect(newConversation).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('ensureLandingConversation creates when workspace has only ghost chats and no slot', async () => {
    useConversationsStore.setState({
      list: [
        meta({ id: 'ghost-1', workspaceId: 'ws-1', updatedAt: 1, eventCount: 0 }),
        meta({ id: 'ghost-2', workspaceId: 'ws-1', updatedAt: 2, eventCount: 0 })
      ],
      activeIdByWorkspace: { 'ws-1': null }
    } as never);

    const result = await useConversationsStore.getState().ensureLandingConversation('ws-1');

    expect(newConversation).toHaveBeenCalledTimes(1);
    expect(result?.id).toBe('conv-created');
  });

  it('ensureLandingConversation creates only for an empty workspace', async () => {
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: {}
    } as never);

    const result = await useConversationsStore.getState().ensureLandingConversation('ws-1');

    expect(newConversation).toHaveBeenCalledTimes(1);
    expect(result?.id).toBe('conv-created');
  });

  it('ensureLandingConversation dedupes concurrent calls', async () => {
    useConversationsStore.setState({ list: [], activeIdByWorkspace: {} } as never);

    const store = useConversationsStore.getState();
    const [a, b] = await Promise.all([
      store.ensureLandingConversation('ws-1'),
      store.ensureLandingConversation('ws-1')
    ]);

    expect(newConversation).toHaveBeenCalledTimes(1);
    expect(a?.id).toBe('conv-created');
    expect(b?.id).toBe('conv-created');
  });
});
