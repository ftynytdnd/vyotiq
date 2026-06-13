import { describe, expect, it, beforeEach } from 'vitest';
import {
  getDiscoveryPollHint,
  recordDiscoveryPollFailure,
  recordDiscoveryPollSuccess,
  __test_resetDiscoveryPollStatus
} from '@main/providers/providerDiscoveryPollStatus.js';

beforeEach(() => {
  __test_resetDiscoveryPollStatus();
});

describe('providerDiscoveryPollStatus', () => {
  it('surfaces a hint after three consecutive failures', () => {
    recordDiscoveryPollFailure('p1', 'HTTP 401');
    recordDiscoveryPollFailure('p1', 'HTTP 401');
    expect(getDiscoveryPollHint('p1')).toBeUndefined();
    recordDiscoveryPollFailure('p1', 'HTTP 401');
    expect(getDiscoveryPollHint('p1')).toContain('HTTP 401');
  });

  it('clears failure count after success', () => {
    recordDiscoveryPollFailure('p1', 'timeout');
    recordDiscoveryPollFailure('p1', 'timeout');
    recordDiscoveryPollFailure('p1', 'timeout');
    recordDiscoveryPollSuccess('p1');
    expect(getDiscoveryPollHint('p1')).toBeUndefined();
  });
});
