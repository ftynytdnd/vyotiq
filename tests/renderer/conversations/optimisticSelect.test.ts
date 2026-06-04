/**
 * `useConversationsStore.select` must flip the chat mirror SYNCHRONOUSLY
 * (before awaiting the JSONL read) so the user never sees a stale
 * sibling-workspace timeline while the new conversation hydrates.
 * The transcript hydration upgrades the slice in place once it
 * resolves.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore, __resetSelectSpinnerForTests } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  __resetSelectSpinnerForTests();
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useConversationsStore.setState({
    list: [
      { id: 'conv-A', title: 'A', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' },
      { id: 'conv-B', title: 'B', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' }
    ],
    activeIdByWorkspace: { 'ws-test': 'conv-A' },
    hydratedIds: new Set<string>(),
    loading: false,
    selecting: false
  });
  useWorkspaceStore.setState({
    list: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }],
    activeId: 'ws-test',
    info: { path: '/tmp/ws', label: 'ws' },
    loading: false
  });
});

describe('useConversationsStore.select — optimistic mirror flip', () => {
  it('flips the chat mirror BEFORE the transcript read resolves', async () => {
    // Make the read hang until we manually resolve it.
    let resolveRead: ((v: { id: string; events: never[] } | null) => void) | null = null;
    window.vyotiq.conversations.read = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    ) as never;

    // Start the select but DON'T await yet.
    const pending = useConversationsStore.getState().select('conv-B');

    // The mirror should ALREADY have flipped to conv-B even though
    // the transcript read has not resolved.
    expect(useChatStore.getState().conversationId).toBe('conv-B');
    expect(useConversationsStore.getState().hydratedIds.has('conv-B')).toBe(false);

    // Now resolve the read with empty events.
    resolveRead!({ id: 'conv-B', events: [] });
    await pending;

    // Post-hydration, the slice is marked hydrated.
    expect(useConversationsStore.getState().hydratedIds.has('conv-B')).toBe(true);
    expect(useChatStore.getState().conversationId).toBe('conv-B');
  });

  it('does not re-read when the slice is already hydrated', async () => {
    useConversationsStore.setState({
      hydratedIds: new Set<string>(['conv-B'])
    });
    useChatStore.setState({
      slices: {
        'conv-B': chatSliceFixture({ conversationId: 'conv-B' })
      }
    });
    const readSpy = vi.fn(async () => null);
    window.vyotiq.conversations.read = readSpy as never;

    await useConversationsStore.getState().select('conv-B');

    expect(readSpy).not.toHaveBeenCalled();
    expect(useChatStore.getState().conversationId).toBe('conv-B');
  });

  it('clears selecting when prewarm lets a superseding select short-circuit', async () => {
    let resolveRead: ((v: { id: string; events: never[] } | null) => void) | null = null;
    window.vyotiq.conversations.read = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    ) as never;

    const pending = useConversationsStore.getState().select('conv-A');
    expect(useConversationsStore.getState().selecting).toBe(true);

    // DockChatStrip prewarm landed while the first JSONL read is still awaiting.
    useConversationsStore.setState({
      hydratedIds: new Set<string>(['conv-A'])
    });

    // App boot effect re-selects the same id once the slice is hydrated.
    await useConversationsStore.getState().select('conv-A');

    resolveRead!({ id: 'conv-A', events: [] });
    await pending;

    expect(useConversationsStore.getState().selecting).toBe(false);
  });
});

describe('useConversationsStore.prewarm', () => {
  it('hydrates a sibling slice WITHOUT touching the active mirror', async () => {
    useChatStore.setState({
      conversationId: 'conv-A',
      slices: {
        'conv-A': chatSliceFixture({ conversationId: 'conv-A' })
      }
    });
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: 'conv-B',
      events: []
    })) as never;

    await useConversationsStore.getState().prewarm('conv-B');

    // Active mirror still on conv-A.
    expect(useChatStore.getState().conversationId).toBe('conv-A');
    // conv-B's slice was seeded.
    expect(useChatStore.getState().slices['conv-B']).toBeTruthy();
    expect(useConversationsStore.getState().hydratedIds.has('conv-B')).toBe(true);
  });

  it('is a no-op when the slice is already hydrated', async () => {
    useConversationsStore.setState({ hydratedIds: new Set<string>(['conv-B']) });
    const readSpy = vi.fn(async () => ({ id: 'conv-B', events: [] }));
    window.vyotiq.conversations.read = readSpy as never;

    await useConversationsStore.getState().prewarm('conv-B');

    expect(readSpy).not.toHaveBeenCalled();
  });
});
