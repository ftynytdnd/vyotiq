import { describe, expect, it } from 'vitest';
import {
  shouldUnloadIdleSlice,
  unloadIdleSlice
} from '@renderer/store/chatStoreRam';
import { emptySlice } from '@renderer/store/chatStoreTypes';

describe('chatStoreRam', () => {
  it('unloadIdleSlice preserves draft and drops transcript weight', () => {
    const slice = {
      ...emptySlice('conv-1'),
      draft: 'typed but unsent',
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi' } as const]
    };
    const unloaded = unloadIdleSlice(slice);
    expect(unloaded.draft).toBe('typed but unsent');
    expect(unloaded.events).toEqual([]);
    expect(unloaded.isProcessing).toBe(false);
  });

  it('shouldUnloadIdleSlice skips in-flight slices', () => {
    const idle = { ...emptySlice('conv-1'), events: [{ kind: 'error', id: 'e1', ts: 1, message: 'x' }] };
    const busy = { ...idle, isProcessing: true, runId: 'run-1' };
    expect(shouldUnloadIdleSlice(idle)).toBe(true);
    expect(shouldUnloadIdleSlice(busy)).toBe(false);
  });
});
