/**
 * `applyEvents` — single Zustand commit for bursty timeline updates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

const toolResult = (callId: string): Extract<TimelineEvent, { kind: 'tool-result' }> => ({
  kind: 'tool-result',
  id: `evt-${callId}`,
  ts: 1,
  result: {
    id: callId,
    name: 'read',
    ok: true,
    output: 'ok',
    durationMs: 1
  }
});

describe('useChatStore.applyEvents', () => {
  beforeEach(() => {
    const freshSlice = chatSliceFixture({ conversationId: 'conv-1' });
    useChatStore.setState((s) => ({
      ...s,
      conversationId: 'conv-1',
      slices: { 'conv-1': freshSlice as (typeof s.slices)[string] },
      runIdToConv: { 'run-1': 'conv-1' },
      events: []
    }));
  });

  it('applies multiple events in one store commit', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      event: toolResult(`c-${i}`)
    }));
    useChatStore.getState().applyEvents('run-1', entries);
    expect(useChatStore.getState().slices['conv-1']!.events).toHaveLength(20);
  });

  it('applyEvent delegates to applyEvents with a single entry', () => {
    const applyEventsSpy = vi.spyOn(useChatStore.getState(), 'applyEvents');
    useChatStore.getState().applyEvent('run-1', toolResult('solo'));
    expect(applyEventsSpy).toHaveBeenCalledTimes(1);
    expect(applyEventsSpy.mock.calls[0]![1]).toHaveLength(1);
    applyEventsSpy.mockRestore();
  });
});
