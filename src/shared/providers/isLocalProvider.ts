import type { ProviderConfig } from '../types/provider.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when the provider base URL targets a loopback / local daemon. */
export function isLocalProvider(provider: Pick<ProviderConfig, 'baseUrl'>): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(provider.baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}
