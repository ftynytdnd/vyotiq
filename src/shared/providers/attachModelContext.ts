/**
 * Attach parsed or curated context windows to a discovered model row.
 */

import type { ProviderWithKey } from '../types/provider.js';
import {
  contextWindowForDeepSeekApiModel,
  isDeepSeekApiHost
} from './modelCapabilities.js';
import { classifyProviderHost } from './providerHostKind.js';
import { enrichModelContext } from './hostModelContext.js';

/** Merge API context with host-specific fallback tables. */
export function attachModelContext(
  provider: ProviderWithKey,
  modelId: string,
  discovered?: number
): number | undefined {
  if (typeof discovered === 'number' && discovered > 0) return discovered;

  if (isDeepSeekApiHost(provider.baseUrl)) {
    return contextWindowForDeepSeekApiModel();
  }

  const hostKind = classifyProviderHost(provider);
  return enrichModelContext(hostKind, modelId, discovered);
}
