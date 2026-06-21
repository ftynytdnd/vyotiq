/**
 * RAF batching of bursty `tool-call` / `tool-result` events — prevents
 * React maximum update depth (#185) on large parallel tool rounds.
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
    onError: () => () => {},
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
    }
  } as IpcCallbacks;
}

const toolCall = (callId: string, name = 'read'): Extract<TimelineEvent, { kind: 'tool-call' }> => ({
  kind: 'tool-call',
  id: `evt-call-${callId}`,
  ts: 1,
  call: { id: callId, name, args: { path: 'a.ts' } }
});

const toolResult = (
  callId: string,
  name = 'read'
): Extract<TimelineEvent, { kind: 'tool-result' }> => ({
  kind: 'tool-result',
  id: `evt-result-${callId}`,
  ts: 2,
  result: {
    id: callId,
    name,
    ok: true,
    output: 'ok',
    durationMs: 1
  }
});

async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('chatChannel — tool-round RAF batcher', () => {
  let cb: IpcCallbacks;
  let applyEventsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    internal.resetForTest();
    cb = patchChatBridge();
    (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
    await bootstrapChatChannel();
    const freshSlice = chatSliceFixture({ conversationId: 'conv-1' });
    useChatStore.setState((s) => ({
      ...s,
      conversationId: 'conv-1',
      slices: { 'conv-1': freshSlice as (typeof s.slices)[string] },
      runIdToConv: { 'run-1': 'conv-1' },
      events: [],
      assistantTexts: {},
      reasoningTexts: {},
      partialToolCallArgs: {},
      runId: null,
      isProcessing: false,
      runStartedAt: null,
      draft: ''
    }));
    applyEventsSpy = vi.spyOn(useChatStore.getState(), 'applyEvents');
  });

  afterEach(() => {
    applyEventsSpy.mockRestore();
    internal.resetForTest();
  });

  it('buffers N tool results and applies them in one applyEvents commit per frame', async () => {
    for (let i = 0; i < 52; i += 1) {
      const id = `call-${i}`;
      cb.onEvent('run-1', toolCall(id));
      cb.onEvent('run-1', toolResult(id));
    }
    expect(applyEventsSpy).not.toHaveBeenCalled();
    await flushRaf();
    expect(applyEventsSpy).toHaveBeenCalledTimes(1);
    const batch = applyEventsSpy.mock.calls[0]![1];
    expect(batch).toHaveLength(104);
    const events = useChatStore.getState().slices['conv-1']!.events;
    expect(events.filter((e) => e.kind === 'tool-call')).toHaveLength(52);
    expect(events.filter((e) => e.kind === 'tool-result')).toHaveLength(52);
  });

  it('flushes pending tool-round events before agent-text-delta', async () => {
    cb.onEvent('run-1', toolResult('late-call'));
    cb.onEvent('run-1', { kind: 'agent-text-delta', id: 'turn-A', ts: 3, delta: 'hi' });
    await flushRaf();
    const events = useChatStore.getState().slices['conv-1']!.events;
    expect(events.some((e) => e.kind === 'tool-result')).toBe(true);
    expect(useChatStore.getState().assistantTexts['turn-A']?.text).toBe('hi');
  });

  it('chat:done flushes buffered tool results before finishing the run', async () => {
    cb.onEvent('run-1', toolResult('tail-call'));
    cb.onDone('run-1');
    expect(useChatStore.getState().slices['conv-1']!.events.some((e) => e.kind === 'tool-result')).toBe(
      true
    );
  });
});
