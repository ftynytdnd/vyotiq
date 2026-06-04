/**
 * Phase 3 (2026) — synthetic mid-stream usage dispatch in
 * `chatChannel.ts`.
 *
 * Pins:
 *   1. Each text/reasoning delta bumps the synthetic char counter
 *      for the matching `(runId, owner)` pair.
 *   2. The RAF drain dispatches a `synthetic-usage-update` event
 *      that the reducer routes onto `TokenUsageAggregate.inFlight`.
 *   3. The model id is read from `useChatStore.runIdToModel` so the
 *      right BPE encoding drives the tokenization. Unknown models
 *      (rehydrated runs without a stamped model) fall back to the
 *      chars/3.8 heuristic.
 *   4. Authoritative `token-usage` clears both the reducer's
 *      `inFlight` AND the channel's local char counter so the next
 *      turn starts from zero.
 *   5. Terminal events (`agent-text-end`, `agent-text-aborted`,
 *      `chat:done`, `chat:error`) wipe the counter for the owner /
 *      run so it can never carry over a stale value.
 *   6. Legacy events with extra fields do not break the `'orc'` owner path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  bootstrapChatChannel,
  __vyotiqChatChannelInternal as internal
} from '@renderer/store/chatChannel';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

interface IpcCallbacks {
  onEvent: (runId: string, event: TimelineEvent) => void;
  onDone: (runId: string) => void;
  onError: (runId: string, message: string) => void;
}

function patchChatBridge(): IpcCallbacks {
  const captured: Partial<IpcCallbacks> = {};
  const stub = {
    send: vi.fn(async () => ({ ok: true, conversationId: 'c1' })),
    abort: vi.fn(async () => undefined),
    onEvent: (fn: IpcCallbacks['onEvent']) => {
      captured.onEvent = fn;
      return () => {
        captured.onEvent = undefined;
      };
    },
    onDone: (fn: IpcCallbacks['onDone']) => {
      captured.onDone = fn;
      return () => {
        captured.onDone = undefined;
      };
    },
    onError: (fn: IpcCallbacks['onError']) => {
      captured.onError = fn;
      return () => {
        captured.onError = undefined;
      };
    },
    submitAskUser: vi.fn(async () => ({ ok: true as const })),
    onAwaitingUser: () => () => {},
    listActiveRuns: vi.fn(async () => [])
  };
  (window.vyotiq as unknown as { chat: typeof stub }).chat = stub;
  return {
    get onEvent() {
      if (!captured.onEvent) throw new Error('onEvent not registered');
      return captured.onEvent;
    },
    get onDone() {
      if (!captured.onDone) throw new Error('onDone not registered');
      return captured.onDone;
    },
    get onError() {
      if (!captured.onError) throw new Error('onError not registered');
      return captured.onError;
    }
  } as IpcCallbacks;
}

const textDelta = (
  id: string,
  delta: string,
  opts: { ts?: number; subagentId?: string } = {}
): Extract<TimelineEvent, { kind: 'agent-text-delta' }> => ({
  kind: 'agent-text-delta',
  id,
  ts: opts.ts ?? 1,
  delta,
  ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
});

const reasoningDelta = (
  id: string,
  delta: string,
  opts: { ts?: number; subagentId?: string } = {}
): Extract<TimelineEvent, { kind: 'agent-reasoning-delta' }> => ({
  kind: 'agent-reasoning-delta',
  id,
  ts: opts.ts ?? 1,
  delta,
  ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
});

async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('chatChannel — synthetic-usage-update dispatch (Phase 3)', () => {
  let cb: IpcCallbacks;

  beforeEach(() => {
    internal.resetForTest();
    cb = patchChatBridge();
    // Force the microtask fallback for deterministic flushes.
    (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      undefined;
    bootstrapChatChannel();
    const freshSlice = chatSliceFixture({ conversationId: 'conv-1' });
    useChatStore.setState((s) => ({
      ...s,
      conversationId: 'conv-1',
      slices: { 'conv-1': freshSlice as (typeof s.slices)[string] },
      runIdToConv: { 'run-1': 'conv-1', 'run-2': 'conv-1' },
      // Phase 3 — pretend the runs were started via `send()` with these
      // models. The synthetic counter reads this to pick the BPE
      // encoding.
      runIdToModel: { 'run-1': 'gpt-5', 'run-2': 'claude-sonnet-4.6' },
      events: [],
      assistantTexts: {},
      reasoningTexts: {},
      partialToolCallArgs: {},
      runId: null,
      isProcessing: false,
      runStartedAt: null,
      draft: ''
    }));
  });

  afterEach(() => {
    internal.resetForTest();
  });

  it('bumps the synthetic counter on each text delta', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'hello '));
    cb.onEvent('run-1', textDelta('turn-A', 'world'));
    expect(internal.syntheticUsageSize()).toBe(1);
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe('hello '.length + 'world'.length);
  });

  it('text + reasoning deltas accumulate onto the same owner', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'visible'));
    cb.onEvent('run-1', reasoningDelta('turn-A', 'hidden'));
    expect(internal.syntheticUsageSize()).toBe(1);
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(
      'visible'.length + 'hidden'.length
    );
  });

  it('dispatches a synthetic-usage-update onto the reducer after the RAF drain', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'a'.repeat(400)));
    await flushRaf();
    const inFlight = useChatStore.getState().orchestratorUsage?.inFlight;
    expect(inFlight).toBeDefined();
    // For a BPE-supported model the token count should be well-bounded
    // — `a` × 400 is roughly 100 tokens on o200k_base (the o200k BPE
    // collapses repeated chars aggressively).
    expect(inFlight!.completionTokens).toBeGreaterThan(0);
    expect(inFlight!.completionTokens).toBeLessThan(400);
    // `latest` is still the zero baseline because no authoritative
    // `token-usage` has landed.
    expect(useChatStore.getState().orchestratorUsage?.latest).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    });
  });

  it('folds streamed text deltas into orchestratorUsage.inFlight', async () => {
    cb.onEvent('run-1', textDelta('turn-sa', 'a'.repeat(300)));
    await flushRaf();
    const state = useChatStore.getState();
    expect(state.orchestratorUsage?.inFlight?.completionTokens).toBeGreaterThan(0);
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(300);
  });

  it('falls back to the chars/3.8 heuristic for non-BPE models', async () => {
    // run-2 was stamped with `claude-sonnet-4.6` above — no public BPE.
    cb.onEvent('run-2', textDelta('turn-B', 'a'.repeat(380)));
    await flushRaf();
    const inFlight = useChatStore.getState().orchestratorUsage?.inFlight;
    expect(inFlight).toBeDefined();
    // 380 / 3.8 === 100 exactly.
    expect(inFlight!.completionTokens).toBe(100);
  });

  it('authoritative token-usage resets the channel counter for the owner', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'pre-usage chars'));
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBeGreaterThan(0);
    cb.onEvent('run-1', {
      kind: 'token-usage',
      id: 'tu-1',
      ts: 5,
      assistantMsgId: 'turn-A',
      usage: { promptTokens: 1000, completionTokens: 60, totalTokens: 1060 }
    });
    // Counter wiped — next delta on the same owner starts from 0.
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(0);
    // And the reducer's inFlight slot is undefined (foldTokenUsage
    // drops it on authoritative arrival).
    expect(useChatStore.getState().orchestratorUsage?.inFlight).toBeUndefined();
    expect(useChatStore.getState().orchestratorUsage?.latest.promptTokens).toBe(1000);
  });

  it('agent-text-end resets the owner counter', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'streaming'));
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe('streaming'.length);
    cb.onEvent('run-1', { kind: 'agent-text-end', id: 'turn-A', ts: 5 });
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(0);
  });

  it('agent-text-aborted resets the owner counter', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'aborting'));
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBeGreaterThan(0);
    cb.onEvent('run-1', { kind: 'agent-text-aborted', id: 'turn-A', ts: 5 });
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(0);
  });

  it('agent-reasoning-end does NOT reset (text stream may still be open)', () => {
    cb.onEvent('run-1', reasoningDelta('turn-A', 'thought'));
    cb.onEvent('run-1', textDelta('turn-A', 'text'));
    const charsBefore = internal.syntheticUsageChars('run-1', 'orc');
    expect(charsBefore).toBe('thought'.length + 'text'.length);
    cb.onEvent('run-1', { kind: 'agent-reasoning-end', id: 'turn-A', ts: 5 });
    // Reasoning-end is NOT a terminal boundary — text stream is still
    // open. Counter must survive.
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(charsBefore);
  });

  it('chat:done wipes ALL synthetic counters for the run', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'orchestrator chars'));
    cb.onEvent('run-2', textDelta('turn-B', 'other run chars'));
    expect(internal.syntheticUsageSize()).toBe(2);
    cb.onDone('run-1');
    // Only run-1's counters are gone; run-2 untouched.
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(0);
    expect(internal.syntheticUsageChars('run-2', 'orc')).toBe('other run chars'.length);
    expect(internal.syntheticUsageSize()).toBe(1);
  });

  it('chat:error wipes ALL synthetic counters for the run', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'will error'));
    cb.onError('run-1', 'boom');
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe(0);
  });

  it('boundary event for run-1 does NOT clear run-2 counters', () => {
    cb.onEvent('run-1', textDelta('turn-A', 'run-1 text'));
    cb.onEvent('run-2', textDelta('turn-B', 'run-2 text'));
    expect(internal.syntheticUsageSize()).toBe(2);
    cb.onEvent('run-1', { kind: 'phase', id: 'p-1', ts: 5, label: 'next' });
    // Phase doesn't reset the synthetic counter — only end / aborted /
    // token-usage / terminal events do.
    expect(internal.syntheticUsageChars('run-1', 'orc')).toBe('run-1 text'.length);
    expect(internal.syntheticUsageChars('run-2', 'orc')).toBe('run-2 text'.length);
  });
});
