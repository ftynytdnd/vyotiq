/**
 * Evict ephemeral provider telemetry when a provider is removed or disabled.
 */

import { evictGeminiExplicitCacheForProvider } from './cacheHints/geminiExplicitCache.js';
import { evictProviderAccountSnapshot } from './providerAccountStore.js';
import { evictProviderRateLimits } from './providerRateLimitCapture.js';
import { evictProviderAccountInFlight } from './fetchProviderAccount.js';

export function evictProviderCaches(providerId: string): void {
  evictProviderAccountSnapshot(providerId);
  evictProviderRateLimits(providerId);
  evictProviderAccountInFlight(providerId);
  evictGeminiExplicitCacheForProvider(providerId);
}
