/**
 * `useConversationsStore.move` — renderer-side optimistic flip + rollback.
 *
 * Pinned invariants:
 *   1. Optimistic update lands BEFORE the IPC resolves (dock moves
 *      the row immediately; the IPC reconciles the meta on success).
 *   2. Source-workspace slot in `activeIdByWorkspace` is cleared if it
 *      pointed at the moved conversation. Without this fix-up, the
 *      user could activate the source workspace and land on a chat
 *      that no longer belongs to it.
 *   3. Same-workspace move is a no-op (no IPC, no state change).
 *   4. IPC failure rolls the optimistic update back AND surfaces a
 *      toast — the user must see why the drag silently failed.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useToastStore } from '@renderer/store/useToastStore';
import type { ConversationMeta } from '@shared/types/chat';

function makeMeta(over: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'c1',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-A',
    ...over
  };
}

beforeEach(() => {
  useConversationsStore.setState({
    list: [],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 0 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
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
  useToastStore.setState({ toasts: [] });
});

describe('useConversationsStore.move — optimistic flip + reconcile', () => {
  it('updates meta.workspaceId optimistically before the IPC resolves', async () => {
    const meta = makeMeta({ id: 'c1', workspaceId: 'ws-A' });
    useConversationsStore.setState({ list: [meta] });

    let releaseIpc: (m: ConversationMeta) => void = () => undefined;
    window.vyotiq.conversations.move = vi.fn(
      () =>
        new Promise<ConversationMeta>((resolve) => {
          releaseIpc = resolve;
        })
    ) as never;

    const movePromise = useConversationsStore.getState().move('c1', 'ws-B');

    // Yield once — the optimistic patch is synchronous so it must
    // already be visible before the IPC has a chance to resolve.
    await Promise.resolve();
    const mid = useConversationsStore.getState().list.find((m) => m.id === 'c1');
    expect(mid?.workspaceId).toBe('ws-B');

    // Release the IPC with main's authoritative meta.
    releaseIpc({
      ...meta,
      workspaceId: 'ws-B',
      updatedAt: 999
    });
    await movePromise;

    const final = useConversationsStore.getState().list.find((m) => m.id === 'c1');
    expect(final?.workspaceId).toBe('ws-B');
    expect(final?.updatedAt).toBe(999);
  });

  it('clears the source workspace slot when it pointed at the moved conversation', async () => {
    useConversationsStore.setState({
      list: [makeMeta({ id: 'c1', workspaceId: 'ws-A' })],
      activeIdByWorkspace: { 'ws-A': 'c1' }
    });
    window.vyotiq.conversations.move = vi.fn(async () =>
      makeMeta({ id: 'c1', workspaceId: 'ws-B', updatedAt: 1 })
    ) as never;

    await useConversationsStore.getState().move('c1', 'ws-B');

    // Source slot is cleared (or null'd). The store stores `null` for
    // explicitly-cleared slots; absent keys also satisfy "not pointing
    // at this id" so we accept either.
    const slot = useConversationsStore.getState().activeIdByWorkspace['ws-A'];
    expect(slot ?? null).toBeNull();
  });

  it('is a no-op when target equals source workspace', async () => {
    useConversationsStore.setState({
      list: [makeMeta({ id: 'c1', workspaceId: 'ws-A' })]
    });
    const ipcSpy = vi.fn(async () => makeMeta()) as never;
    window.vyotiq.conversations.move = ipcSpy;

    await useConversationsStore.getState().move('c1', 'ws-A');

    expect((ipcSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    // List is structurally identical (no churned timestamps, no
    // workspaceId mutation).
    const after = useConversationsStore.getState().list.find((m) => m.id === 'c1');
    expect(after?.workspaceId).toBe('ws-A');
    expect(after?.updatedAt).toBe(0);
  });

  it('rolls back the optimistic update and surfaces a toast on IPC failure', async () => {
    const original = makeMeta({ id: 'c1', workspaceId: 'ws-A', updatedAt: 100 });
    useConversationsStore.setState({
      list: [original],
      activeIdByWorkspace: { 'ws-A': 'c1' }
    });
    window.vyotiq.conversations.move = vi.fn(async () => {
      throw new Error('main rejected');
    }) as never;

    await useConversationsStore.getState().move('c1', 'ws-B');

    // List restored to source workspace, original timestamp.
    const after = useConversationsStore.getState().list.find((m) => m.id === 'c1');
    expect(after?.workspaceId).toBe('ws-A');
    expect(after?.updatedAt).toBe(100);

    // Source-workspace slot restored.
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('c1');

    // Toast surfaces the underlying error message.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toMatch(/main rejected/);
    expect(toasts[0]?.tone).toBe('danger');
  });

  it('logs and returns silently when the conversation id is unknown locally', async () => {
    const ipcSpy = vi.fn(async () => makeMeta()) as never;
    window.vyotiq.conversations.move = ipcSpy;

    await useConversationsStore.getState().move('nope', 'ws-B');

    // Unknown ids never reach main — the renderer's optimistic flip
    // would have nothing to update, so dispatching an IPC would be a
    // wasted round-trip. The store logs and returns.
    expect((ipcSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});
