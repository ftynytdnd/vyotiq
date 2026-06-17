/**
 * Landing conversation prewarm — auto-creates only for empty workspaces
 * after session boot is ready.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLandingConversationPrewarm } from '@renderer/pages/useLandingConversationPrewarm';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

describe('useLandingConversationPrewarm', () => {
  const ensureLandingConversation = vi.fn(async () => ({
    id: 'conv-new',
    title: 'Untitled',
    updatedAt: 0,
    workspaceId: 'ws-1'
  }));

  beforeEach(() => {
    ensureLandingConversation.mockClear();
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: {},
      hydratedIds: new Set(),
      loading: false,
      activeSlotsHydrated: true,
      ensureLandingConversation
    } as never);
  });

  it('ensures a landing conversation when boot is ready and workspace is empty', async () => {
    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1'
      })
    );

    await waitFor(() => {
      expect(ensureLandingConversation).toHaveBeenCalledWith('ws-1');
    });
  });

  it('waits for session boot before ensuring', async () => {
    useConversationsStore.setState({ loading: true, activeSlotsHydrated: false } as never);

    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1'
      })
    );

    await waitFor(() => {
      expect(ensureLandingConversation).not.toHaveBeenCalled();
    });
  });

  it('skips when setup is required or landing is disabled', async () => {
    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: true,
        needsSetup: true,
        selecting: false,
        activeWorkspaceId: 'ws-1'
      })
    );

    await waitFor(() => {
      expect(ensureLandingConversation).not.toHaveBeenCalled();
    });

    renderHook(() =>
      useLandingConversationPrewarm({
        enabled: false,
        needsSetup: false,
        selecting: false,
        activeWorkspaceId: 'ws-1'
      })
    );

    expect(ensureLandingConversation).not.toHaveBeenCalled();
  });
});
