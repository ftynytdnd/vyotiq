/**
 * Multi-session contract for `useConversationsStore.select`.
 *
 * Pre-multi-session, `select` aborted the in-flight run before loading
 * the new transcript so the main-side orchestrator wouldn't keep
 * streaming events into the old JSONL. That contract is INVERTED in
 * the multi-session architecture:
 *
 *   - Slices are per-conversation. The old conversation's slice keeps
 *     its `runId / isProcessing / runStartedAt` and continues to
 *     receive events via `runIdToConv` dispatch.
 *   - The main process still serializes appends per-conversation
 *     (existing `appendChains`), so two concurrent runs in TWO
 *     conversations write into TWO transcripts — no interleave.
 *   - The renderer mirror flips to the new conversation's slice
 *     (existing or freshly hydrated) without touching the prior slice.
 *
 * These tests pin the new contract: `chat.abort` is NEVER called on
 * select, the prior slice retains its `runId`, and the mirror points
 * at the new slice.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

beforeEach(() => {
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
    list: [],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
  // Single workspace registered, active. Without an active workspace,
  // `select` is a no-op (the multi-workspace contract requires it),
  // so every test path needs a registered active id.
  useWorkspaceStore.setState({
    list: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }],
    activeId: 'ws-test',
    info: { path: '/tmp/ws', label: 'ws' },
    loading: false
  });
  // Reset IPC spies.
  window.vyotiq.chat.abort = vi.fn(async () => undefined) as never;
  window.vyotiq.conversations.read = vi.fn(async () => null) as never;
});

describe('useConversationsStore.select — multi-session contract', () => {
  it('does NOT abort the in-flight run when switching to a different conversation', async () => {
    // Simulate a live run in conversation "A". The slice carries the
    // run id; the mirror reflects the active slice.
    useChatStore.setState({
      slices: {
        'conv-A': {
          ...useChatStore.getState().slices['conv-A'],
          conversationId: 'conv-A',
          events: [],
          assistantTexts: {},
          reasoningTexts: {},
          orchestratorUsage: undefined,
          runId: 'run-live-1',
          isProcessing: true,
          runStartedAt: Date.now()
        }
      },
      runIdToConv: { 'run-live-1': 'conv-A' },
      conversationId: 'conv-A',
      runId: 'run-live-1',
      isProcessing: true,
      runStartedAt: Date.now()
    });
    useConversationsStore.setState({
      list: [
        { id: 'conv-A', title: 'A', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' },
        { id: 'conv-B', title: 'B', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' }
      ],
      activeIdByWorkspace: { 'ws-test': 'conv-A' }
    });

    const abortSpy = vi.fn(async () => undefined);
    window.vyotiq.chat.abort = abortSpy as never;
    const readSpy = vi.fn(async () => ({ id: 'conv-B', events: [] } as never));
    window.vyotiq.conversations.read = readSpy as never;

    await useConversationsStore.getState().select('conv-B');

    // The whole point of the multi-session architecture: NO abort on switch.
    expect(abortSpy).not.toHaveBeenCalled();

    // Mirror flipped to conv-B (post-hydration). The prior slice for
    // conv-A retains its in-flight runId so events keep dispatching
    // there.
    const chat = useChatStore.getState();
    expect(chat.conversationId).toBe('conv-B');
    expect(chat.slices['conv-A']?.runId).toBe('run-live-1');
    expect(chat.slices['conv-A']?.isProcessing).toBe(true);
    expect(chat.runIdToConv['run-live-1']).toBe('conv-A');
  });

  it('records the new active id under the active workspace slot', async () => {
    useConversationsStore.setState({
      list: [
        { id: 'conv-A', title: 'A', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' },
        { id: 'conv-B', title: 'B', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' }
      ],
      activeIdByWorkspace: { 'ws-test': 'conv-A' }
    });
    window.vyotiq.conversations.read = vi.fn(async () => ({ id: 'conv-B', events: [] } as never)) as never;

    await useConversationsStore.getState().select('conv-B');

    expect(useConversationsStore.getState().activeIdByWorkspace['ws-test']).toBe('conv-B');
  });

  it('is a no-op when re-selecting the current conversation (already mirrored)', async () => {
    useChatStore.setState({
      conversationId: 'conv-A',
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          ...useChatStore.getState().slices['conv-A']
        })
      }
    });
    useConversationsStore.setState({
      list: [
        { id: 'conv-A', title: 'A', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' }
      ],
      activeIdByWorkspace: { 'ws-test': 'conv-A' },
      hydratedIds: new Set<string>(['conv-A'])
    });

    const abortSpy = vi.fn(async () => undefined);
    const readSpy = vi.fn(async () => null);
    window.vyotiq.chat.abort = abortSpy as never;
    window.vyotiq.conversations.read = readSpy as never;

    await useConversationsStore.getState().select('conv-A');

    expect(abortSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
  });
});
