/**
 * Capture rate-limit response headers from upstream provider calls.
 * Used to populate account snapshots when no dedicated balance API exists.
 */

import type { ProviderRateLimits } from '@shared/types/providerAccount.js';

const snapshots = new Map<string, ProviderRateLimits>();

function positiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function resetMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    // Heuristic: values > 1e12 are ms epoch; smaller values are seconds.
    return n > 1_000_000_000_000 ? n : n * 1000;
  }
  const asDate = Date.parse(trimmed);
  return Number.isFinite(asDate) ? asDate : undefined;
}

/** Parse common OpenAI/Groq/Anthropic-style rate-limit headers. */
export function parseRateLimitHeaders(headers: Headers): ProviderRateLimits | undefined {
  const requestsLimit =
    positiveInt(headers.get('x-ratelimit-limit-requests')) ??
    positiveInt(headers.get('anthropic-ratelimit-requests-limit'));
  const requestsRemaining =
    positiveInt(headers.get('x-ratelimit-remaining-requests')) ??
    positiveInt(headers.get('anthropic-ratelimit-requests-remaining'));
  const tokensLimit =
    positiveInt(headers.get('x-ratelimit-limit-tokens')) ??
    positiveInt(headers.get('anthropic-ratelimit-tokens-limit'));
  const tokensRemaining =
    positiveInt(headers.get('x-ratelimit-remaining-tokens')) ??
    positiveInt(headers.get('anthropic-ratelimit-tokens-remaining'));
  const resetAt =
    resetMs(headers.get('x-ratelimit-reset-requests')) ??
    resetMs(headers.get('x-ratelimit-reset-tokens')) ??
    resetMs(headers.get('anthropic-ratelimit-requests-reset')) ??
    resetMs(headers.get('anthropic-ratelimit-tokens-reset'));

  if (
    requestsLimit === undefined &&
    requestsRemaining === undefined &&
    tokensLimit === undefined &&
    tokensRemaining === undefined
  ) {
    return undefined;
  }

  const out: ProviderRateLimits = {};
  if (requestsLimit !== undefined) out.requestsLimit = requestsLimit;
  if (requestsRemaining !== undefined) out.requestsRemaining = requestsRemaining;
  if (tokensLimit !== undefined) out.tokensLimit = tokensLimit;
  if (tokensRemaining !== undefined) out.tokensRemaining = tokensRemaining;
  if (resetAt !== undefined) out.resetAt = resetAt;
  return out;
}

export function recordProviderRateLimits(
  providerId: string,
  headers: Headers | undefined
): void {
  if (!headers) return;
  const parsed = parseRateLimitHeaders(headers);
  if (!parsed) return;
  snapshots.set(providerId, parsed);
}

export function getProviderRateLimits(providerId: string): ProviderRateLimits | undefined {
  return snapshots.get(providerId);
}

export function evictProviderRateLimits(providerId: string): void {
  snapshots.delete(providerId);
}

/** Test-only reset. */
export function __test_resetProviderRateLimits(): void {
  snapshots.clear();
}
