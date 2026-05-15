/**
 * Regression tests for the pre-create-on-send fix.
 *
 * Pre-fix bug (verified end-to-end):
 *   1. Renderer's `useChatStore.send` left `conversationId` as
 *      `undefined` on the auto-create path and registered the
 *      `runIdToConv[runId]` mapping ONLY after the `chat:send` IPC
 *      reply resolved.
 *   2. Main's `startRun` emitted `user-prompt` synchronously BEFORE
 *      its IPC handler returned. IPC delivery is FIFO, so the
 *      renderer received the event first and `applyEvent` dropped
 *      it (no mapping yet).
 *   3. After the reply, `bindActive(boundId)` derived `wsId` from
 *      `list.find(...)` — but the freshly created meta wasn't in
 *      `list` yet, so `activeIdByWorkspace[workspaceId]` was never
 *      written. App.tsx's sync effect then cleared the mirror.
 *
 * Net user-visible effect: prompt vanished + session never became
 * active. Matches the screenshot the user reported.
 *
 * The fix pre-creates the conversation in the renderer before
 * dispatching `chat:send`, registers the mapping synchronously,
 * and passes `workspaceId` explicitly to `bindActive`. These
 * tests pin all three invariants:
 *
 *   A. `conversations.create` is awaited BEFORE `chat.send`.
 *   B. The runId mapping is in place by the time `applyEvent` is
 *      called for the synthetic `user-prompt`, so the event lands
 *      on the slice instead of being dropped.
 *   C. `activeIdByWorkspace[workspaceId]` is set after the reply,
 *      independent of whether `list` has been refreshed yet.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

const baseSelection = { providerId: 'p1', modelId: 'm1' };
const basePerms = { allowFileWrites: false, allowBash: false, allowWebSearch: false };

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
    list: [],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
  useWorkspaceStore.setState({
    list: [{ id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 }],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
  // Default chat.send: resolved with the same conversationId we sent.
  // Each test overrides as needed.
});

describe('useChatStore.send — pre-create eliminates IPC event-order race', () => {
  it('awaits conversations.create BEFORE calling chat.send when no conversation is active', async () => {
    const callOrder: string[] = [];
    window.vyotiq.conversations.create = vi.fn(async () => {
      callOrder.push('create');
      return {
        id: 'conv-fresh',
        title: 'New conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        eventCount: 0,
        workspaceId: 'ws-A'
      } as never;
    }) as never;
    window.vyotiq.chat.send = vi.fn(async (input: { conversationId?: string }) => {
      callOrder.push('send');
      // Main echoes our pre-created id (no auto-create on this path).
      return { ok: true, conversationId: input.conversationId ?? 'should-not-happen' } as never;
    }) as never;

    await useChatStore.getState().send('hello', baseSelection, basePerms);

    expect(callOrder).toEqual(['create', 'send']);
    expect(window.vyotiq.chat.send).toHaveBeenCalledTimes(1);
    const sentInput = (window.vyotiq.chat.send as unknown as { mock: { calls: Array<[{ conversationId: string }]> } }).mock.calls[0]![0];
    expect(sentInput.conversationId).toBe('conv-fresh');
  });

  it('registers runIdToConv mapping before chat.send is dispatched (no event-order race)', async () => {
    let mappingAtSendTime: Record<string, string> = {};
    window.vyotiq.conversations.create = vi.fn(async () => ({
      id: 'conv-fresh',
      title: 'New',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 0,
      workspaceId: 'ws-A'
    } as never)) as never;
    window.vyotiq.chat.send = vi.fn(async (input: { runId: string; conversationId?: string }) => {
      // Snapshot the mapping the moment `chat.send` is invoked. If the
      // race regressed, this snapshot would be empty for the auto-create
      // path. Post-fix, the mapping must already be set.
      mappingAtSendTime = { ...useChatStore.getState().runIdToConv };
      return { ok: true, conversationId: input.conversationId ?? 'fail' } as never;
    }) as never;

    await useChatStore.getState().send('hi', baseSelection, basePerms);

    // The runId we just used should already be mapped to conv-fresh by
    // the time `chat.send` was called. The exact runId is internal so
    // we assert the *value* side of the mapping.
    const mappedConvIds = Object.values(mappingAtSendTime);
    expect(mappedConvIds).toContain('conv-fresh');
  });

  it('survives a synthetic chat:event arriving while chat.send is still in-flight', async () => {
    // Simulate the original race: the IPC reply takes a tick, but a
    // user-prompt event is delivered immediately. Pre-fix, the event
    // would be dropped (no runIdToConv mapping yet); post-fix it lands
    // on the pre-created slice.
    window.vyotiq.conversations.create = vi.fn(async () => ({
      id: 'conv-fresh',
      title: 'New',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 0,
      workspaceId: 'ws-A'
    } as never)) as never;

    let releaseSendReply: (v: { ok: true; conversationId: string }) => void = () => undefined;
    let runIdSeen = '';
    window.vyotiq.chat.send = vi.fn(async (input: { runId: string }) => {
      runIdSeen = input.runId;
      // Fire the synthetic event in the same tick that chat.send was
      // called — the renderer's chatChannel would deliver it via
      // `applyEvent` BEFORE the reply resolved.
      useChatStore.getState().applyEvent(input.runId, {
        kind: 'user-prompt',
        id: 'evt-1',
        ts: Date.now(),
        content: 'hello world'
      });
      return new Promise<{ ok: true; conversationId: string }>((resolve) => {
        releaseSendReply = resolve;
      }) as never;
    }) as never;

    const sendPromise = useChatStore.getState().send('hello world', baseSelection, basePerms);

    // Yield so the create+send chain can begin. After this microtask
    // turn, the synthetic user-prompt has been dispatched.
    await Promise.resolve();
    await Promise.resolve();

    // The event must have landed on the pre-created slice, NOT been
    // dropped. The slice's events array carries the user-prompt.
    const sliceMid = useChatStore.getState().slices['conv-fresh'];
    expect(sliceMid).toBeDefined();
    expect(sliceMid!.events.some((e) => e.kind === 'user-prompt' && e.id === 'evt-1')).toBe(true);

    // Now release the IPC reply and let `send` finish.
    releaseSendReply({ ok: true, conversationId: 'conv-fresh' });
    await sendPromise;

    // Final state: same slice, event still present, mapping still set.
    const sliceFinal = useChatStore.getState().slices['conv-fresh'];
    expect(sliceFinal!.events.some((e) => e.kind === 'user-prompt' && e.id === 'evt-1')).toBe(true);
    expect(useChatStore.getState().runIdToConv[runIdSeen]).toBe('conv-fresh');
  });

  it('writes activeIdByWorkspace[workspaceId] from the explicit arg even when list is empty', async () => {
    window.vyotiq.conversations.create = vi.fn(async () => ({
      id: 'conv-fresh',
      title: 'New',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 0,
      workspaceId: 'ws-A'
    } as never)) as never;
    window.vyotiq.chat.send = vi.fn(async (input: { conversationId?: string }) => ({
      ok: true,
      conversationId: input.conversationId ?? 'fail'
    } as never)) as never;
    // Block conversations.list refresh from finding the new meta —
    // this simulates the original race where bindActive's `list.find`
    // lookup would miss the just-created conversation.
    window.vyotiq.conversations.list = vi.fn(async () => []) as never;

    await useChatStore.getState().send('hi', baseSelection, basePerms);

    // The slot for the active workspace must be set to the new id —
    // independent of whether the list has been refreshed yet.
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('conv-fresh');
  });

  it('aborts cleanly when no active workspace is set', async () => {
    useWorkspaceStore.setState({ list: [], activeId: null, info: { path: null, label: null } });
    const createSpy = vi.fn(async () => ({} as never));
    const sendSpy = vi.fn(async () => ({ ok: true, conversationId: 'x' } as never));
    window.vyotiq.conversations.create = createSpy as never;
    window.vyotiq.chat.send = sendSpy as never;

    await useChatStore.getState().send('hi', baseSelection, basePerms);

    // No IPC traffic when there's nowhere to land the run.
    expect(createSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useChatStore.getState().isProcessing).toBe(false);
  });

  it('surfaces a mirror error when no active workspace is set so the user knows why', async () => {
    // Composer.handleSend clears the textarea BEFORE awaiting send. A
    // silent abort would erase the user's typed prompt with zero
    // feedback. Verify an error event lands on the mirror so the user
    // can see "Pick a workspace before sending a message." without
    // hunting through logs.
    useWorkspaceStore.setState({ list: [], activeId: null, info: { path: null, label: null } });
    window.vyotiq.conversations.create = vi.fn(async () => ({} as never)) as never;
    window.vyotiq.chat.send = vi.fn(async () => ({ ok: true, conversationId: 'x' } as never)) as never;

    await useChatStore.getState().send('hello', baseSelection, basePerms);

    const mirror = useChatStore.getState();
    const errorEvents = mirror.events.filter((e) => e.kind === 'error');
    expect(errorEvents.length).toBe(1);
    expect((errorEvents[0] as { message: string }).message).toMatch(/workspace/i);
  });
});

describe('useConversationsStore.bindActive — explicit workspaceId path', () => {
  it('writes the slot from the explicit workspaceId arg when the meta is not in list', () => {
    // Pre-fix, this scenario was the second half of the race: the
    // freshly-created conversation hadn't been added to `list` yet,
    // so `bindActive` early-returned without writing the slot.
    useConversationsStore.setState({ list: [], activeIdByWorkspace: {} });

    useConversationsStore.getState().bindActive('conv-X', 'ws-A');

    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('conv-X');
    // The hydration set is also stamped — `bindActive` is the canonical
    // "this conversation is now ours" signal, regardless of where the
    // workspaceId came from.
    expect(useConversationsStore.getState().hydratedIds.has('conv-X')).toBe(true);
  });

  it('falls back to list.find when no workspaceId is passed (legacy contract)', () => {
    useConversationsStore.setState({
      list: [
        { id: 'conv-Y', title: 'Y', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-B' }
      ],
      activeIdByWorkspace: {}
    });

    useConversationsStore.getState().bindActive('conv-Y');

    expect(useConversationsStore.getState().activeIdByWorkspace['ws-B']).toBe('conv-Y');
  });

  it('skips both lookups when the slot is already set to the same id', () => {
    useConversationsStore.setState({
      list: [],
      activeIdByWorkspace: { 'ws-A': 'conv-X' }
    });

    useConversationsStore.getState().bindActive('conv-X', 'ws-A');

    // No-op patch: slot still points at conv-X (unchanged), no churn.
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBe('conv-X');
  });
});
