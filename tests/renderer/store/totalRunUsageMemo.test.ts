import { describe, expect, it, beforeEach } from 'vitest';
import {
  useChatStore,
  __resetTotalRunUsageCacheForTests
} from '@renderer/store/useChatStore';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { mirrorOf } from '@renderer/store/chatStoreMirror';
import type { TimelineEvent } from '@shared/types/chat';

const CONV_ID = 'conv-memo-1';
const RUN_ID = 'run-memo-1';

beforeEach(() => {
  __resetTotalRunUsageCacheForTests();
  const slice = {
    ...emptySlice(CONV_ID),
    runId: RUN_ID,
    isProcessing: true,
    runStartedAt: 0
  };
  useChatStore.setState({
    slices: { [CONV_ID]: slice },
    runIdToConv: { [RUN_ID]: CONV_ID },
    ...mirrorOf(slice)
  });
});

function tokenUsageEvent(
  overrides: Partial<TimelineEvent & { kind: 'token-usage' }> = {}
): TimelineEvent {
  return {
    kind: 'token-usage',
    id: 'tu-1',
    ts: 1,
    assistantMsgId: 'asst-1',
    usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    ...overrides
  } as TimelineEvent;
}

function deltaEvent(id: string, delta: string): TimelineEvent {
  return { kind: 'agent-text-delta', id, ts: 2, delta };
}

describe('useChatStore — totalRunUsage memo', () => {
  it('returns the same reference when usage unchanged', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    const first = useChatStore.getState().totalRunUsage;
    store.applyEvent(RUN_ID, deltaEvent('msg-1', 'more text'));
    const second = useChatStore.getState().totalRunUsage;
    expect(second).toBe(first);
  });

  it('updates orchestratorUsage when token-usage events land', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    expect(useChatStore.getState().orchestratorUsage?.latest.promptTokens).toBe(100);
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-2',
        usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
      })
    );
    expect(useChatStore.getState().orchestratorUsage?.latest.promptTokens).toBe(200);
  });
});
