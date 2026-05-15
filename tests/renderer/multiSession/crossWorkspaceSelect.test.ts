/**
 * Cross-workspace `select` regression — pins the multi-workspace
 * correctness of `useConversationsStore.select(id)`.
 *
 * Before the fix, clicking a row in a sibling workspace's group
 * stamped `activeIdByWorkspace[activeA] = idFromB`, leaving the active
 * workspace's slot pointing at a foreign conversation until a
 * subsequent reconcile nulled it. The fix activates the conversation's
 * OWN workspace first and writes the slot under that workspace.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useToastStore } from '@renderer/store/useToastStore';

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
  useConversationsStore.setState({
    list: [
      { id: 'conv-A', title: 'A', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-A' },
      { id: 'conv-B', title: 'B', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-B' }
    ],
    activeIdByWorkspace: { 'ws-A': 'conv-A', 'ws-B': null },
    hydratedIds: new Set<string>(['conv-A']),
    loading: false
  });
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
  useToastStore.setState({ toasts: [] });
});

describe('useConversationsStore.select — cross-workspace correctness', () => {
  it('attributes the slot under the conversation\'s OWN workspace, never the source', async () => {
    // Resolve the workspace flip immediately so we can observe the
    // post-await state.
    window.vyotiq.workspace.setActive = vi.fn(async () => ({
      activeId: 'ws-B',
      workspaces: [
        { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
        { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
      ]
    })) as never;
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: 'conv-B',
      events: []
    })) as never;

    await useConversationsStore.getState().select('conv-B');

    const slots = useConversationsStore.getState().activeIdByWorkspace;
    // The picked conversation lives in B — the slot under B is set.
    expect(slots['ws-B']).toBe('conv-B');
    // A's slot must NOT have been corrupted with the foreign id.
    expect(slots['ws-A']).toBe('conv-A');
    // The destination workspace was activated.
    expect(useWorkspaceStore.getState().activeId).toBe('ws-B');
    // Chat mirror is on the picked conversation.
    expect(useChatStore.getState().conversationId).toBe('conv-B');
  });

  it('does not call workspace.setActive when the conversation is already in the active workspace', async () => {
    const setActiveSpy = vi.fn(async () => ({
      activeId: 'ws-A',
      workspaces: []
    }));
    window.vyotiq.workspace.setActive = setActiveSpy as never;
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: 'conv-A',
      events: []
    })) as never;

    await useConversationsStore.getState().select('conv-A');

    expect(setActiveSpy).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeId).toBe('ws-A');
  });

  it('persists the destination slot via settings IPC', async () => {
    window.vyotiq.workspace.setActive = vi.fn(async () => ({
      activeId: 'ws-B',
      workspaces: [
        { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
        { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
      ]
    })) as never;
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: 'conv-B',
      events: []
    })) as never;
    const settingsSpy = vi.fn(async (patch: object) => patch);
    window.vyotiq.settings.set = settingsSpy as never;

    await useConversationsStore.getState().select('conv-B');

    // The persisted activeConversationByWorkspace map written by the
    // store carries the destination workspace's slot, not the source's.
    const persisted = settingsSpy.mock.calls
      .map((c) => c[0] as { ui?: { activeConversationByWorkspace?: Record<string, string> } })
      .find((p) => p.ui?.activeConversationByWorkspace);
    expect(persisted?.ui?.activeConversationByWorkspace?.['ws-B']).toBe('conv-B');
    expect(persisted?.ui?.activeConversationByWorkspace?.['ws-A']).toBe('conv-A');
  });

  it('falls back to the active workspace with a warn when meta is not in the list', async () => {
    // Conversation id is unknown — meta lookup fails. The legacy
    // single-workspace path should still apply.
    window.vyotiq.conversations.read = vi.fn(async () => null) as never;
    const setActiveSpy = vi.fn(async () => ({ activeId: 'ws-A', workspaces: [] }));
    window.vyotiq.workspace.setActive = setActiveSpy as never;

    await useConversationsStore.getState().select('conv-ghost');

    // No spurious cross-workspace flip — the active workspace stays
    // intact because we don't know where the orphan id belongs.
    expect(setActiveSpy).not.toHaveBeenCalled();
    // Slot under the active workspace is updated to the orphan id —
    // that's the legacy fallback (the row will get cleaned up by the
    // next `reconcileWithMain`).
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('conv-ghost');
  });
});
