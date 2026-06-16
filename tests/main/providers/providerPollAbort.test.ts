import { describe, expect, it } from 'vitest';
import { isSupersededProviderPollAbort } from '@main/providers/providerPollAbort.js';

describe('isSupersededProviderPollAbort', () => {
  it('returns true for abort errors and messages', () => {
    expect(
      isSupersededProviderPollAbort(
        Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
      )
    ).toBe(true);
    expect(isSupersededProviderPollAbort('This operation was aborted')).toBe(true);
    expect(isSupersededProviderPollAbort({ message: 'The user aborted a request.' })).toBe(true);
  });

  it('returns false for real provider failures', () => {
    expect(isSupersededProviderPollAbort({ message: 'HTTP 401 Unauthorized' })).toBe(false);
    expect(isSupersededProviderPollAbort(new Error('network timeout'))).toBe(false);
  });

  it('returns true when the poll signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isSupersededProviderPollAbort(new Error('other'), controller.signal)).toBe(true);
  });
});
