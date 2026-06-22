/**
 * Audit fix A3 — RAF batching of `agent-text-delta` /
 * `agent-reasoning-delta` events in the chat channel.
 *
 * Pins:
 *   1. Multiple deltas with the same `(runId, id, kind)` queued in
 *      one frame coalesce into ONE accumulator entry (size invariant).
 *   2. The batched flush dispatches ONE merged event whose `delta`
 *      is the concatenation of every queued chunk — the reducer's
 *      `text + event.delta` accumulation still produces the same
 *      final body the un-batched path would have produced.
 *   3. A boundary event (`agent-text-end`) flushes any pending
 *      matching deltas BEFORE dispatching itself — preserves causal
 *      ordering against the reducer.
 *   4. `chat:done` / `chat:error` flush ALL pending entries for the
 *      run before clearing run state, so the renderer never observes
 *      a "settled then late delta" sequence on terminal runs.
 *   5. Cross-run isolation: a flush for `run-1` does not touch
 *      `run-2`'s pending entries.
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
      return () => { captured.onEvent = undefined; };
    },
    onDone: (fn: IpcCallbacks['onDone']) => {
      captured.onDone = fn;
      return () => { captured.onDone = undefined; };
    },
    onError: (fn: IpcCallbacks['onError']) => {
      captured.onError = fn;
      return () => { captured.onError = undefined; };
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
  opts: { ts?: number } = {}
): Extract<TimelineEvent, { kind: 'agent-reasoning-delta' }> => ({
  kind: 'agent-reasoning-delta',
  id,
  ts: opts.ts ?? 1,
  delta
});

async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('chatChannel — text/reasoning-delta RAF batcher', () => {
  let cb: IpcCallbacks;

  beforeEach(() => {
    internal.resetForTest();
    cb = patchChatBridge();
    // Force the microtask fallback for deterministic flushes.
    (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
    bootstrapChatChannel();
    // Reset the entire store slice + mirror so per-test accumulator
    // state does not leak across cases. `setState` with `replace = true`
    // would wipe the action methods bound at create-time; instead we
    // assemble a clean slice and explicitly overwrite the mirror
    // fields that selectors read.
    const freshSlice = chatSliceFixture({ conversationId: 'conv-1' });
    useChatStore.setState((s) => ({
      ...s,
      conversationId: 'conv-1',
      slices: { 'conv-1': freshSlice as (typeof s.slices)[string] },
      runIdToConv: { 'run-1': 'conv-1', 'run-2': 'conv-1' },
      // Mirror — selectors read directly from these.
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

  it('coalesces N rapid text deltas into ONE accumulator entry per frame', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'hel', { ts: 1 }));
    cb.onEvent('run-1', textDelta('turn-A', 'lo, ', { ts: 2 }));
    cb.onEvent('run-1', textDelta('turn-A', 'world', { ts: 3 }));
    // BEFORE flush: exactly one accumulator entry.
    expect(internal.textDeltaAccumulatorSize()).toBe(1);
    expect(internal.textDeltaAccumulatorKeys()).toEqual([
      'run-1\u0000turn-A\u0000agent-text-delta'
    ]);
    await flushRaf();
    // AFTER flush: entry dropped because buf empties out.
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    // The reducer sums the deltas into the assistantTexts accumulator
    // for this id — same final body as the un-batched path.
    const txt = useChatStore.getState().assistantTexts['turn-A'];
    expect(txt?.text).toBe('hello, world');
  });

  it('separates text vs reasoning into distinct accumulator entries', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'visible '));
    cb.onEvent('run-1', reasoningDelta('turn-A', 'hidden '));
    expect(internal.textDeltaAccumulatorSize()).toBe(2);
    await flushRaf();
    const s = useChatStore.getState();
    expect(s.assistantTexts['turn-A']?.text).toBe('visible ');
    expect(s.reasoningTexts['turn-A']?.text).toBe('hidden ');
  });

  it('agent-text-end flushes pending deltas BEFORE its own dispatch', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'streaming '));
    cb.onEvent('run-1', textDelta('turn-A', 'chunks'));
    // End event lands BEFORE the RAF fires — must drain synchronously.
    cb.onEvent('run-1', { kind: 'agent-text-end', id: 'turn-A', ts: 5 });
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    const txt = useChatStore.getState().assistantTexts['turn-A'];
    expect(txt?.text).toBe('streaming chunks');
    expect(txt?.done).toBe(true);
  });

  it('agent-text-aborted flushes + drops both text AND reasoning accumulators for the id', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'going to '));
    cb.onEvent('run-1', reasoningDelta('turn-A', 'thinking '));
    expect(internal.textDeltaAccumulatorSize()).toBe(2);
    cb.onEvent('run-1', { kind: 'agent-text-aborted', id: 'turn-A', ts: 5 });
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    // The reducer's abort branch drops the accumulator entirely.
    expect(useChatStore.getState().assistantTexts['turn-A']).toBeUndefined();
  });

  it('a non-delta event implicitly flushes ALL pending deltas for the run', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'pre '));
    cb.onEvent('run-1', reasoningDelta('turn-B', 'side '));
    expect(internal.textDeltaAccumulatorSize()).toBe(2);
    // A non-delta event is not id-targeted — its arrival implicitly
    // closes EVERY in-flight stream so the persisted / dispatched
    // ordering stays `deltas → thought`.
    cb.onEvent('run-1', { kind: 'agent-thought', id: 'p-1', ts: 5, content: 'next' });
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    const s = useChatStore.getState();
    expect(s.assistantTexts['turn-A']?.text).toBe('pre ');
    expect(s.reasoningTexts['turn-B']?.text).toBe('side ');
  });

  it('chat:done flushes pending deltas for the run before clearing run state', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'tail '));
    expect(internal.textDeltaAccumulatorSize()).toBe(1);
    cb.onDone('run-1');
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    // The accumulator was drained so the partial text landed BEFORE
    // the slice's run fields were cleared.
    expect(useChatStore.getState().assistantTexts['turn-A']?.text).toBe('tail ');
  });

  it('chat:error flushes pending deltas for the run before surfacing the error', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'half '));
    expect(internal.textDeltaAccumulatorSize()).toBe(1);
    cb.onError('run-1', 'provider blew up');
    expect(internal.textDeltaAccumulatorSize()).toBe(0);
    expect(useChatStore.getState().assistantTexts['turn-A']?.text).toBe('half ');
  });

  it('a boundary event for run-1 does NOT touch pending entries for run-2', async () => {
    cb.onEvent('run-1', textDelta('turn-A', 'A1 '));
    cb.onEvent('run-2', textDelta('turn-B', 'B1 '));
    expect(internal.textDeltaAccumulatorSize()).toBe(2);
    cb.onEvent('run-1', { kind: 'agent-thought', id: 'p-1', ts: 5, content: 'next' });
    // run-1's entry was flushed; run-2's is untouched.
    expect(internal.textDeltaAccumulatorSize()).toBe(1);
    expect(internal.textDeltaAccumulatorKeys()).toEqual([
      'run-2\u0000turn-B\u0000agent-text-delta'
    ]);
  });
});
