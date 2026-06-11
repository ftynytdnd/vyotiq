/**
 * Landing conversation prewarm — creates or selects a conversation on
 * empty-chat landing so attachments work before first send.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLandingConversationPrewarm } from '@renderer/pages/useLandingConversationPrewarm';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

describe('useLandingConversationPrewarm', () => {
  const newConversation = vi.fn(async () => ({
    id: 'conv-new',
    title: 'Untitled',
    updatedAt: 0,
    workspaceId: 'ws-1'
  }));
  const select = vi.fn(async () => undefined);

  beforeEach(() => {
    newConversation.mockClear();
    select.mockClear();
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: {},
      hydratedIds: new Set(),
      loading: false,
      newConversation,
      select
    } as never);
  });

  it('creates a conversation when landing is ready and no slot exists', async () => {
    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: null,
        chatConversationId: null
      })
    );

    await waitFor(() => {
      expect(newConversation).toHaveBeenCalledTimes(1);
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('selects the active slot when chat mirror is out of sync', async () => {
    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: 'conv-existing',
        chatConversationId: null
      })
    );

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith('conv-existing');
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('flips the chat mirror without IPC when the slot is already hydrated', async () => {
    useConversationsStore.setState({
      list: [{ id: 'conv-existing', title: 'T', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' }],
      activeIdByWorkspace: { 'ws-1': 'conv-existing' },
      hydratedIds: new Set(['conv-existing']),
      loading: false,
      selecting: false,
      newConversation,
      select
    } as never);

    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: 'conv-existing',
        chatConversationId: null
      })
    );

    await waitFor(() => {
      expect(useChatStore.getState().conversationId).toBe('conv-existing');
    });
    expect(select).not.toHaveBeenCalled();
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('skips select for a stale slot absent from the catalogue', async () => {
    useConversationsStore.setState({
      list: [{ id: 'conv-live', title: 'T', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-1' }],
      activeIdByWorkspace: { 'ws-1': 'conv-stale' },
      hydratedIds: new Set<string>(),
      loading: false,
      selecting: false,
      newConversation,
      select
    } as never);

    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: 'conv-stale',
        chatConversationId: null
      })
    );

    await waitFor(() => {
      expect(select).not.toHaveBeenCalled();
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('skips when setup is required or landing is disabled', async () => {
    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: true,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: null,
        chatConversationId: null
      })
    );

    await waitFor(() => {
      expect(newConversation).not.toHaveBeenCalled();
    });

    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: false,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1',
        activeConversationId: null,
        chatConversationId: null
      })
    );

    expect(newConversation).not.toHaveBeenCalled();
  });
});
