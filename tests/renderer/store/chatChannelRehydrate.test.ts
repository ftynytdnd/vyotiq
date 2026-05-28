/**
 * Regression: `bootstrapChatChannel` rehydrates active runs before
 * subscribing to `chat:event` so early events are not dropped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  bootstrapChatChannel,
  __vyotiqChatChannelInternal as pool
} from '@renderer/store/chatChannel';
import { useChatStore } from '@renderer/store/useChatStore';

const bootOrder: string[] = [];

let resolveRuns!: (value: Array<{
  runId: string;
  conversationId: string;
  workspaceId: string;
  providerId: string;
  startedAt: number;
}>) => void;

beforeEach(() => {
  bootOrder.length = 0;
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    conversationId: null,
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    summaries: {},
    messageOverrides: {},
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });

  const runsPromise = new Promise<
    Array<{
      runId: string;
      conversationId: string;
      workspaceId: string;
      providerId: string;
      startedAt: number;
    }>
  >((resolve) => {
    resolveRuns = resolve;
  });

  (window.vyotiq as unknown as { chat: object }).chat = {
    send: vi.fn(),
    abort: vi.fn(),
    onEvent: (fn: (runId: string, event: TimelineEvent) => void) => {
      bootOrder.push('subscribe-event');
      (window as unknown as { __testOnEvent?: typeof fn }).__testOnEvent = fn;
      return () => undefined;
    },
    onDone: () => {
      bootOrder.push('subscribe-done');
      return () => undefined;
    },
    onError: () => {
      bootOrder.push('subscribe-error');
      return () => undefined;
    },
    listActiveRuns: vi.fn(async () => {
      bootOrder.push('rehydrate-start');
      const runs = await runsPromise;
      bootOrder.push('rehydrate-end');
      return runs;
    })
  };
});

afterEach(() => {
  const g = globalThis as unknown as { __vyotiqChatChannelUnsub?: Array<() => void> };
  if (Array.isArray(g.__vyotiqChatChannelUnsub)) {
    for (const fn of g.__vyotiqChatChannelUnsub) fn();
    g.__vyotiqChatChannelUnsub = undefined;
  }
});

describe('bootstrapChatChannel rehydrate ordering', () => {
  it('awaits listActiveRuns before registering chat:event', async () => {
    const boot = bootstrapChatChannel();
    expect(bootOrder).toEqual(['rehydrate-start']);

    resolveRuns([
      {
        runId: 'run-1',
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
        providerId: 'prov-1',
        startedAt: Date.now()
      }
    ]);
    await boot;

    expect(bootOrder).toEqual([
      'rehydrate-start',
      'rehydrate-end',
      'subscribe-event',
      'subscribe-done',
      'subscribe-error'
    ]);
    expect(useChatStore.getState().runIdToConv['run-1']).toBe('conv-1');
  });

  it('routes events after rehydrate completes', async () => {
    const boot = bootstrapChatChannel();
    resolveRuns([
      {
        runId: 'run-1',
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
        providerId: 'prov-1',
        startedAt: Date.now()
      }
    ]);
    await boot;

    const onEvent = (window as unknown as { __testOnEvent?: (runId: string, e: TimelineEvent) => void })
      .__testOnEvent;
    expect(onEvent).toBeDefined();

    onEvent!('run-1', {
      kind: 'agent-thought',
      id: 't1',
      ts: 1,
      content: 'thinking'
    });

    expect(useChatStore.getState().slices['conv-1']?.events).toHaveLength(1);
  });

  it('clears parser pool on second bootstrap (HMR teardown)', async () => {
    const prevRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;

    useChatStore.setState((s) => ({
      ...s,
      runIdToConv: { ...s.runIdToConv, 'run-1': 'conv-1' }
    }));

    const boot1 = bootstrapChatChannel();
    resolveRuns([]);
    await boot1;

    const onEvent = (window as unknown as { __testOnEvent?: (runId: string, e: TimelineEvent) => void })
      .__testOnEvent;
    onEvent!('run-1', {
      kind: 'tool-call-args-delta',
      id: 'd1',
      ts: 1,
      callId: 'c1',
      index: 0,
      name: 'edit',
      argsBuf: '{"path":"a.ts"'
    });
    // Parser is created when the delta is fed through feedParser on drain;
    // enqueue alone only schedules the RAF batcher.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(pool.parserPoolSize()).toBeGreaterThan(0);

    const boot2 = bootstrapChatChannel();
    resolveRuns([]);
    await boot2;
    expect(pool.parserPoolSize()).toBe(0);

    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = prevRaf;
  });
});
