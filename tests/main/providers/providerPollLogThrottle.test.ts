import { describe, expect, it, beforeEach } from 'vitest';
import {
  shouldLogRepeatedPollWarning,
  recordPollSuccess,
  __test_resetProviderPollLogThrottle
} from '@main/providers/providerPollLogThrottle.js';

beforeEach(() => {
  __test_resetProviderPollLogThrottle();
});

describe('providerPollLogThrottle', () => {
  it('logs the first failure and suppresses immediate repeats', () => {
    expect(shouldLogRepeatedPollWarning('k', 'fetch failed', 0)).toBe(true);
    expect(shouldLogRepeatedPollWarning('k', 'fetch failed', 1)).toBe(false);
    expect(shouldLogRepeatedPollWarning('k', 'fetch failed', 2)).toBe(false);
  });

  it('logs again when the message changes', () => {
    shouldLogRepeatedPollWarning('k', 'fetch failed', 0);
    expect(shouldLogRepeatedPollWarning('k', 'timeout', 1)).toBe(true);
  });

  it('logs every 20th repeat', () => {
    let t = 0;
    for (let i = 0; i < 19; i++) {
      shouldLogRepeatedPollWarning('k', 'fetch failed', t++);
    }
    expect(shouldLogRepeatedPollWarning('k', 'fetch failed', t++)).toBe(true);
  });

  it('clears state after success', () => {
    shouldLogRepeatedPollWarning('k', 'fetch failed', 0);
    recordPollSuccess('k');
    expect(shouldLogRepeatedPollWarning('k', 'fetch failed', 1)).toBe(true);
  });
});
