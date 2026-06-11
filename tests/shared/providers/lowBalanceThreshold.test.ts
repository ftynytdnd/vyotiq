import { describe, expect, it } from 'vitest';
import {
  computeLowBalanceThreshold,
  isBalanceLow
} from '@shared/providers/lowBalanceThreshold.js';

describe('lowBalanceThreshold', () => {
  it('uses percent of reference balance when known', () => {
    expect(computeLowBalanceThreshold(100)).toBe(10);
    expect(computeLowBalanceThreshold(5)).toBe(1);
  });

  it('falls back to fixed USD when reference unknown', () => {
    expect(computeLowBalanceThreshold(undefined)).toBe(1);
  });

  it('flags low balance below threshold', () => {
    expect(isBalanceLow(0.5, 100)).toBe(true);
    expect(isBalanceLow(15, 100)).toBe(false);
    expect(isBalanceLow(0.5, undefined)).toBe(true);
  });
});
