import { describe, expect, it } from 'vitest';
import {
  LIVE_TOKEN_RATE_MIN_SPAN_MS,
  LIVE_TOKEN_RATE_WINDOW_MS,
  appendTokenRateSample,
  computeRollingTokenRate,
  formatLiveTokenRate,
  resolveLiveCompletionTokens
} from '@renderer/lib/liveTokenRate';

describe('resolveLiveCompletionTokens', () => {
  it('sums latest and in-flight completion counts', () => {
    expect(
      resolveLiveCompletionTokens({
        latest: { completionTokens: 40 },
        inFlight: { completionTokens: 12 }
      })
    ).toBe(52);
  });

  it('returns 0 when usage is undefined', () => {
    expect(resolveLiveCompletionTokens(undefined)).toBe(0);
  });
});

describe('computeRollingTokenRate', () => {
  it('returns null with fewer than two samples', () => {
    expect(computeRollingTokenRate([{ ts: 1000, completionTokens: 5 }], 2000)).toBeNull();
  });

  it('computes rate over the rolling window', () => {
    const samples = [
      { ts: 1000, completionTokens: 0 },
      { ts: 2000, completionTokens: 50 }
    ];
    expect(computeRollingTokenRate(samples, 2000)).toBe(50);
  });

  it('returns null when span is below the minimum', () => {
    const samples = [
      { ts: 1000, completionTokens: 0 },
      { ts: 1000 + LIVE_TOKEN_RATE_MIN_SPAN_MS - 1, completionTokens: 10 }
    ];
    expect(computeRollingTokenRate(samples, samples[1]!.ts)).toBeNull();
  });

  it('drops samples outside the window', () => {
    const now = 10_000;
    const samples = [
      { ts: now - LIVE_TOKEN_RATE_WINDOW_MS - 500, completionTokens: 0 },
      { ts: now - 2000, completionTokens: 10 },
      { ts: now, completionTokens: 30 }
    ];
    expect(computeRollingTokenRate(samples, now)).toBe(10);
  });

  it('returns null when tokens did not increase', () => {
    const samples = [
      { ts: 1000, completionTokens: 20 },
      { ts: 2500, completionTokens: 20 }
    ];
    expect(computeRollingTokenRate(samples, 2500)).toBeNull();
  });
});

describe('formatLiveTokenRate', () => {
  it('uses one decimal below 10 tok/s', () => {
    expect(formatLiveTokenRate(3.24)).toBe('3.2 tok/s');
  });

  it('rounds at 10 tok/s and above', () => {
    expect(formatLiveTokenRate(12.6)).toBe('13 tok/s');
  });

  it('returns empty for non-positive values', () => {
    expect(formatLiveTokenRate(0)).toBe('');
  });
});

describe('appendTokenRateSample', () => {
  it('dedupes identical tail samples', () => {
    const first = appendTokenRateSample([], 1000, 5);
    const second = appendTokenRateSample(first, 1000, 5);
    expect(second).toBe(first);
  });

  it('caps retained samples', () => {
    let samples = [] as ReturnType<typeof appendTokenRateSample>;
    for (let i = 0; i < 40; i += 1) {
      samples = appendTokenRateSample(samples, i * 100, i);
    }
    expect(samples.length).toBe(32);
    expect(samples[0]?.completionTokens).toBe(8);
  });
});
