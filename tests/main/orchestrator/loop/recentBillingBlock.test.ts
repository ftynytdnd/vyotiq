import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  BILLING_BLOCK_TTL_MS,
  billingBlockKeyForSelection,
  getRecentBillingBlock,
  setRecentBillingBlock,
  __test_resetRecentBillingBlock
} from '@main/orchestrator/loop/recentBillingBlock';

describe('recentBillingBlock', () => {
  beforeEach(() => {
    __test_resetRecentBillingBlock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keys blocks per provider and model', () => {
    const a = billingBlockKeyForSelection({ providerId: 'openrouter', modelId: 'model-a' });
    const b = billingBlockKeyForSelection({ providerId: 'openrouter', modelId: 'model-b' });
    expect(a).not.toBe(b);
  });

  it('does not block a sibling model on the same provider', () => {
    setRecentBillingBlock(
      { providerId: 'p', modelId: 'blocked' },
      'DeepSeek: Insufficient balance.'
    );
    expect(getRecentBillingBlock({ providerId: 'p', modelId: 'blocked' })?.message).toMatch(
      /Insufficient balance/
    );
    expect(getRecentBillingBlock({ providerId: 'p', modelId: 'other' })).toBeUndefined();
  });

  it('expires blocks after TTL', () => {
    setRecentBillingBlock({ providerId: 'p', modelId: 'm' }, 'billing error');
    vi.advanceTimersByTime(BILLING_BLOCK_TTL_MS);
    expect(getRecentBillingBlock({ providerId: 'p', modelId: 'm' })).toBeUndefined();
  });
});
