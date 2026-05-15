/**
 * `lockToolCallIds` is the only thing standing between the
 * orchestrator and OpenAI-compat providers rejecting the next request
 * with "tool_call_ids did not have response messages". Locking it down
 * here.
 */

import { describe, expect, it } from 'vitest';
import { lockToolCallIds } from '@main/orchestrator/loop/lockToolCallIds';

describe('lockToolCallIds', () => {
  it('mints an id for calls that lack one', () => {
    const calls: Array<{ id?: string }> = [{}, {}];
    lockToolCallIds(calls);
    expect(calls[0]?.id).toBeTruthy();
    expect(calls[1]?.id).toBeTruthy();
    expect(calls[0]?.id).not.toBe(calls[1]?.id);
  });

  it('preserves an existing id verbatim', () => {
    const calls: Array<{ id?: string }> = [{ id: 'fixed-1' }, {}];
    lockToolCallIds(calls);
    expect(calls[0]?.id).toBe('fixed-1');
    expect(calls[1]?.id).toBeTruthy();
  });

  it('is a no-op for an empty array', () => {
    const calls: Array<{ id?: string }> = [];
    expect(() => lockToolCallIds(calls)).not.toThrow();
    expect(calls).toEqual([]);
  });
});
