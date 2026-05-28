/**
 * `useChatStore.rehydrateActiveRuns` is the renderer-reload safety
 * net: after a HMR / F5, main's `activeRuns` map still has live
 * orchestrator loops streaming events, but the renderer's
 * `runIdToConv` dispatch table is empty. Without rehydration those
 * events are silently dropped by `applyEvent`'s missing-mapping
 * guard. This test pins the contract used by `bootstrapChatChannel`.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import type { ActiveRunInfo } from '@shared/types/ipc';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    runIdToModel: {},
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
});

describe('useChatStore.rehydrateActiveRuns', () => {
  it('seeds runIdToConv and per-slice in-flight fields for each entry', () => {
    const infos: ActiveRunInfo[] = [
      { runId: 'r1', conversationId: 'cA', workspaceId: 'wA', startedAt: 1_000, modelId: 'gpt-4' },
      { runId: 'r2', conversationId: 'cB', workspaceId: 'wB', startedAt: 2_000, modelId: 'claude-3' }
    ];
    useChatStore.getState().rehydrateActiveRuns(infos);

    const s = useChatStore.getState();
    expect(s.runIdToConv).toEqual({ r1: 'cA', r2: 'cB' });
    expect(s.runIdToModel).toEqual({ r1: 'gpt-4', r2: 'claude-3' });
    expect(s.slices['cA']?.runId).toBe('r1');
    expect(s.slices['cA']?.isProcessing).toBe(true);
    expect(s.slices['cA']?.runStartedAt).toBe(1_000);
    expect(s.slices['cB']?.runId).toBe('r2');
    expect(s.slices['cB']?.isProcessing).toBe(true);
  });

  it('skips entries without a bound conversationId (pre-binding window)', () => {
    useChatStore.getState().rehydrateActiveRuns([
      { runId: 'r-pre', startedAt: 0 } as ActiveRunInfo,
      { runId: 'r-bound', conversationId: 'cA', startedAt: 0 }
    ]);
    const s = useChatStore.getState();
    expect(s.runIdToConv).toEqual({ 'r-bound': 'cA' });
    expect(s.slices['cA']?.runId).toBe('r-bound');
  });

  it('does not clobber an already-mapped runId', () => {
    useChatStore.setState({
      runIdToConv: { r1: 'cExisting' },
      slices: {
        cExisting: chatSliceFixture({
          conversationId: 'cExisting',
          runId: 'r1',
          isProcessing: true,
          runStartedAt: 5_000
        })
      }
    });
    useChatStore.getState().rehydrateActiveRuns([
      { runId: 'r1', conversationId: 'cOther', startedAt: 9_999 }
    ]);
    // Existing mapping wins. The dispatch table stays correct so
    // late events for r1 still land in the existing slice.
    const s = useChatStore.getState();
    expect(s.runIdToConv).toEqual({ r1: 'cExisting' });
    expect(s.slices['cExisting']?.runStartedAt).toBe(5_000);
  });

  it('refreshes the active mirror when a rehydrated slice is the active one', () => {
    useChatStore.setState({ conversationId: 'cA' });
    useChatStore.getState().rehydrateActiveRuns([
      { runId: 'r1', conversationId: 'cA', startedAt: 1 }
    ]);
    const s = useChatStore.getState();
    // Top-level mirror reflects the just-rehydrated slice's runId.
    expect(s.runId).toBe('r1');
    expect(s.isProcessing).toBe(true);
  });

  it('is a no-op for an empty list', () => {
    useChatStore.setState({ runIdToModel: { stale: 'old-model' } });
    useChatStore.getState().rehydrateActiveRuns([]);
    const s = useChatStore.getState();
    expect(s.runIdToConv).toEqual({});
    expect(s.runIdToModel).toEqual({});
    expect(s.slices).toEqual({});
  });

  it('prunes stale runIdToModel entries not in the snapshot', () => {
    useChatStore.setState({
      runIdToConv: { r1: 'cA', rStale: 'cOld' },
      runIdToModel: { r1: 'keep-me', rStale: 'drop-me' }
    });
    useChatStore.getState().rehydrateActiveRuns([
      { runId: 'r1', conversationId: 'cA', modelId: 'authoritative' }
    ]);
    const s = useChatStore.getState();
    expect(s.runIdToConv).toEqual({ r1: 'cA' });
    expect(s.runIdToModel).toEqual({ r1: 'authoritative' });
  });
});

describe('useChatStore.abortRun', () => {
  it('flips isProcessing on the bound slice and dispatches the IPC', async () => {
    useChatStore.setState({
      slices: {
        cA: chatSliceFixture({
          conversationId: 'cA',
          runId: 'r1',
          isProcessing: true,
          runStartedAt: 1
        })
      },
      runIdToConv: { r1: 'cA' }
    });

    let invokedRunId: string | null = null;
    window.vyotiq.chat.abort = (async (rid: string) => {
      invokedRunId = rid;
    }) as never;

    await useChatStore.getState().abortRun('r1');

    expect(invokedRunId).toBe('r1');
    expect(useChatStore.getState().slices['cA']?.isProcessing).toBe(false);
  });

  it('is a no-op for an unknown runId', async () => {
    let calls = 0;
    window.vyotiq.chat.abort = (async () => {
      calls += 1;
    }) as never;
    await useChatStore.getState().abortRun('does-not-exist');
    expect(calls).toBe(1); // Still dispatches — main is the source of truth.
  });
});
