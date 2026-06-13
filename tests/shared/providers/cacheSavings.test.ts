import { describe, expect, it } from 'vitest';
import {
  estimateCacheSavings,
  formatCacheSavingsUsd,
  OPENROUTER_PLATFORM_FEE_MULTIPLIER
} from '@shared/providers/cacheSavings.js';
import { estimateRunCost } from '@shared/providers/estimateRunCost.js';

describe('estimateCacheSavings', () => {
  const pricing = {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cachedInputPerMillion: 0.3,
    cacheWriteInputPerMillion: 3.75
  };

  it('returns zero savings when no cached tokens', () => {
    const s = estimateCacheSavings({ promptTokens: 1000, cachedPromptTokens: 0 }, pricing);
    expect(s?.grossSavingsUsd).toBe(0);
    expect(s?.netSavingsUsd).toBe(0);
  });

  it('computes gross savings from full vs cached input rate', () => {
    const s = estimateCacheSavings(
      { promptTokens: 1_000_000, cachedPromptTokens: 500_000 },
      pricing
    );
    // 500k * (3 - 0.3) / 1M = 1.35
    expect(s?.grossSavingsUsd).toBeCloseTo(1.35, 4);
    expect(s?.netSavingsUsd).toBeCloseTo(1.35, 4);
  });

  it('subtracts cache write surcharge for net savings', () => {
    const s = estimateCacheSavings(
      {
        promptTokens: 50_000,
        cachedPromptTokens: 900_000,
        cacheCreationTokens: 50_000
      },
      pricing
    );
    expect(s?.grossSavingsUsd).toBeCloseTo(2.43, 4);
    expect(s?.netSavingsUsd).toBeCloseTo(2.2425, 4);
  });

  it('applies OpenRouter platform fee multiplier', () => {
    const s = estimateCacheSavings(
      { promptTokens: 1_000_000, cachedPromptTokens: 1_000_000 },
      { inputPerMillion: 10, outputPerMillion: 30, cachedInputPerMillion: 1 },
      OPENROUTER_PLATFORM_FEE_MULTIPLIER
    );
    expect(s?.grossSavingsUsd).toBeCloseTo(9 * OPENROUTER_PLATFORM_FEE_MULTIPLIER, 4);
  });
});

describe('formatCacheSavingsUsd', () => {
  it('formats positive savings', () => {
    expect(formatCacheSavingsUsd(0.003)).toMatch(/^saved ~/);
  });

  it('returns empty for non-positive', () => {
    expect(formatCacheSavingsUsd(0)).toBe('');
  });
});

describe('estimateRunCost with platform fee', () => {
  it('includes gross and net cache savings on breakdown', () => {
    const est = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 0, cachedPromptTokens: 500_000 },
      { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.2 }
    );
    expect(est?.grossCacheSavingsUsd).toBeGreaterThan(0);
    expect(est?.netCacheSavingsUsd).toBe(est?.grossCacheSavingsUsd);
  });

  it('applies platform fee multiplier to totals', () => {
    const base = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 0 },
      { inputPerMillion: 1, outputPerMillion: 1 }
    );
    const withFee = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 0 },
      { inputPerMillion: 1, outputPerMillion: 1 },
      1,
      { platformFeeMultiplier: OPENROUTER_PLATFORM_FEE_MULTIPLIER }
    );
    expect(withFee?.totalUsd).toBeCloseTo((base?.totalUsd ?? 0) * OPENROUTER_PLATFORM_FEE_MULTIPLIER, 6);
  });
});
