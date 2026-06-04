/**
 * Default per-dialect ceilings for parallel sub-agent `streamChat` calls.
 * Persisted on provider records as `maxConcurrentStreams` so
 * `resolveDelegateRoundConcurrency` can clamp model-declared concurrency
 * without a Settings UI.
 */

import type { ProviderDialect } from '../types/provider.js';

/** Host defaults when a provider record omits `maxConcurrentStreams`. */
const DEFAULT_MAX_CONCURRENT_STREAMS_BY_DIALECT: Readonly<
  Record<ProviderDialect, number>
> = {
  openai: 32,
  'anthropic-native': 16,
  'gemini-native': 16,
  'ollama-native': 8
};

export function defaultMaxConcurrentStreamsForDialect(
  dialect: ProviderDialect | undefined
): number {
  return DEFAULT_MAX_CONCURRENT_STREAMS_BY_DIALECT[dialect ?? 'openai'];
}
