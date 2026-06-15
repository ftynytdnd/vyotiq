/**
 * Live completion-token throughput for streaming runs.
 *
 * Rolling-window rate over recent samples — reacts to bursts and stalls
 * without the lag of a full-run average. Fed by authoritative
 * `token-usage` plus renderer-local `synthetic-usage-update` estimates.
 */

/** Rolling window length for tok/s (ms). */
export const LIVE_TOKEN_RATE_WINDOW_MS = 2500;

/** Minimum span between oldest and newest sample before reporting (ms). */
export const LIVE_TOKEN_RATE_MIN_SPAN_MS = 500;

/** Sample cadence while a run is active (ms). */
export const LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS = 250;

/** Hard cap on retained samples — bounds memory for long runs. */
export const LIVE_TOKEN_RATE_MAX_SAMPLES = 32;

export interface TokenRateSample {
  ts: number;
  completionTokens: number;
}

/**
 * Merge authoritative latest completion with the synthetic in-flight
 * estimate for the current streaming segment.
 */
export function resolveLiveCompletionTokens(
  usage: { latest: { completionTokens: number }; inFlight?: { completionTokens: number } } | undefined
): number {
  if (!usage) return 0;
  return usage.latest.completionTokens + (usage.inFlight?.completionTokens ?? 0);
}

/**
 * Compute tokens/sec from samples within `windowMs` of `now`.
 * Returns `null` when the window is too short or tokens did not grow.
 */
export function computeRollingTokenRate(
  samples: readonly TokenRateSample[],
  now: number,
  windowMs = LIVE_TOKEN_RATE_WINDOW_MS,
  minSpanMs = LIVE_TOKEN_RATE_MIN_SPAN_MS
): number | null {
  if (samples.length < 2) return null;

  const cutoff = now - windowMs;
  let startIdx = 0;
  while (startIdx < samples.length - 1 && samples[startIdx]!.ts < cutoff) {
    startIdx += 1;
  }

  const start = samples[startIdx]!;
  const end = samples[samples.length - 1]!;
  const spanMs = end.ts - start.ts;
  if (spanMs < minSpanMs) return null;

  const deltaTokens = end.completionTokens - start.completionTokens;
  if (deltaTokens <= 0) return null;

  return (deltaTokens / spanMs) * 1000;
}

/** User-facing rate label — one decimal below 10 tok/s. */
export function formatLiveTokenRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  if (rate < 10) return `${rate.toFixed(1)} tok/s`;
  return `${Math.round(rate)} tok/s`;
}

export function appendTokenRateSample(
  samples: TokenRateSample[],
  ts: number,
  completionTokens: number,
  maxSamples = LIVE_TOKEN_RATE_MAX_SAMPLES
): TokenRateSample[] {
  const last = samples[samples.length - 1];
  if (last && last.ts === ts && last.completionTokens === completionTokens) {
    return samples;
  }
  const next = [...samples, { ts, completionTokens }];
  if (next.length <= maxSamples) return next;
  return next.slice(next.length - maxSamples);
}
