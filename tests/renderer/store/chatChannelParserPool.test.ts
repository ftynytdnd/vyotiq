/**
 * Phase 1.1 — partial-JSON parser pool lifecycle in `chatChannel`.
 *
 * Pins three invariants:
 *   1. The pool stays bounded across a long stream — it grows by
 *      one per `(runId, callId)` and never above `n` concurrent
 *      tool calls.
 *   2. The pool drops a parser the moment the matching authoritative
 *      `tool-call` lands (real id and surrogate paths).
 *   3. Run termination (`chat:done` / `chat:error`) and HMR teardown
 *      both wipe every parser for the run, so a long session can
 *      never accumulate dead entries.
 *
 * The boot guard wires a fresh listener stack on each call; we
 * leverage it directly rather than mocking the IPC layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  bootstrapChatChannel,
  __vyotiqChatChannelInternal as pool
} from '@renderer/store/chatChannel';
import { useChatStore } from '@renderer/store/useChatStore';

interface IpcCallbacks {
  onEvent: (runId: string, event: TimelineEvent) => void;
  onDone: (runId: string) => void;
  onError: (runId: string, message: string) => void;
}

/**
 * Capture the listener callbacks `bootstrapChatChannel` registers so
 * the test can drive the pool directly. The renderer setup stub
 * exposes `subscribe = () => () => {}`, but we want the actual
 * callbacks. Patch `window.vyotiq.chat` for the duration of the
 * test.
 */
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
    listActiveRuns: vi.fn(async () => [])
  };
  (window.vyotiq as unknown as { chat: typeof stub }).chat = stub;
  // Return a getter so the assertions read the current callback,
  // not the snapshot at registration time.
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

const makeArgsDelta = (
  callId: string,
  argsBuf: string,
  opts: { name?: string; index?: number; ts?: number; subagentId?: string } = {}
): Extract<TimelineEvent, { kind: 'tool-call-args-delta' }> => ({
  kind: 'tool-call-args-delta',
  id: `d-${callId}-${opts.ts ?? 0}`,
  ts: opts.ts ?? 1,
  callId,
  ...(opts.name !== undefined ? { name: opts.name } : {}),
  index: opts.index ?? 0,
  argsBuf,
  ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
});

/**
 * Drive the RAF batcher synchronously by triggering the queueMicrotask
 * fallback path that `rafBatch.ts` uses when `requestAnimationFrame`
 * is unavailable. Happy-dom provides RAF; we shim it to a
 * `queueMicrotask` here for deterministic flushes inside the test.
 */
async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('chatChannel — partial-JSON parser pool', () => {
  let cb: IpcCallbacks;

  beforeEach(() => {
    pool.resetForTest();
    cb = patchChatBridge();
    // Force the RAF batcher into microtask mode so test flushes are
    // synchronous. happy-dom does provide RAF, but we want
    // determinism.
    (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
    bootstrapChatChannel();
    // Seed the dispatch table so `applyEvent` doesn't drop deltas.
    useChatStore.setState((s) => ({
      ...s,
      runIdToConv: { ...s.runIdToConv, 'run-1': 'conv-1' }
    }));
  });

  afterEach(() => {
    pool.resetForTest();
  });

  it('grows the pool by one per distinct callId and never above the live concurrency', async () => {
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    cb.onEvent('run-1', makeArgsDelta('c2', '{"path":"b.ts"', { name: 'edit', index: 1 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(2);
    // Subsequent deltas on the same callIds reuse the existing parser.
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts","oldString":"x"', { name: 'edit', index: 0 }));
    cb.onEvent('run-1', makeArgsDelta('c2', '{"path":"b.ts","oldString":"y"', { name: 'edit', index: 1 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(2);
  });

  it('drops the parser when the authoritative tool-call lands (real callId)', async () => {
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(1);
    cb.onEvent('run-1', {
      kind: 'tool-call',
      id: 'evt-c1',
      ts: 5,
      call: { id: 'c1', name: 'edit', args: { path: 'a.ts' } }
    });
    expect(pool.parserPoolSize()).toBe(0);
  });

  it('reconciles surrogate callIds by lowest index', async () => {
    cb.onEvent('run-1', makeArgsDelta('pending:orc:0', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    cb.onEvent('run-1', makeArgsDelta('pending:orc:1', '{"path":"b.ts"', { name: 'edit', index: 1 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(2);
    cb.onEvent('run-1', {
      kind: 'tool-call',
      id: 'evt-real-1',
      ts: 5,
      call: { id: 'real-1', name: 'edit', args: { path: 'a.ts' } }
    });
    // Lowest-index surrogate dropped, the other survives.
    expect(pool.parserPoolKeys()).toEqual(['run-1\u0000pending:orc:1']);
  });

  it('wipes every parser for a run on chat:done', async () => {
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    cb.onEvent('run-1', makeArgsDelta('c2', '{"path":"b.ts"', { name: 'edit', index: 1 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(2);
    cb.onDone('run-1');
    expect(pool.parserPoolSize()).toBe(0);
  });

  it('wipes every parser for a run on chat:error', async () => {
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(1);
    cb.onError('run-1', 'provider blew up');
    expect(pool.parserPoolSize()).toBe(0);
  });

  it('wipes the orchestrator partials on agent-text-aborted', async () => {
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(1);
    cb.onEvent('run-1', { kind: 'agent-text-aborted', id: 'turn-1', ts: 5 });
    expect(pool.parserPoolSize()).toBe(0);
  });

  it('keeps parser entries for one run isolated from another run', async () => {
    useChatStore.setState((s) => ({
      ...s,
      runIdToConv: { ...s.runIdToConv, 'run-2': 'conv-2' }
    }));
    cb.onEvent('run-1', makeArgsDelta('c1', '{"path":"a.ts"', { name: 'edit', index: 0 }));
    cb.onEvent('run-2', makeArgsDelta('c1', '{"path":"b.ts"', { name: 'edit', index: 0 }));
    await flushRaf();
    expect(pool.parserPoolSize()).toBe(2);
    cb.onDone('run-1');
    // Only run-1's entry was cleared.
    expect(pool.parserPoolKeys()).toEqual(['run-2\u0000c1']);
  });
});
