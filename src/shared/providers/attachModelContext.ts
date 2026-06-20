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

export interface AttachedModelContext {
  contextWindow?: number;
  /** True when the window came from host tables or a host-wide default. */
  contextEstimated?: boolean;
}

/** Merge API context with host-specific fallback tables. */
export function attachModelContext(
  provider: ProviderWithKey,
  modelId: string,
  discovered?: number
): AttachedModelContext {
  if (typeof discovered === 'number' && discovered > 0) {
    return { contextWindow: discovered };
  }

  if (isDeepSeekApiHost(provider.baseUrl)) {
    return {
      contextWindow: contextWindowForDeepSeekApiModel(),
      contextEstimated: true
    };
  }

  const hostKind = classifyProviderHost(provider);
  const fromHost = enrichModelContext(hostKind, modelId, discovered);
  if (fromHost !== undefined) {
    return { contextWindow: fromHost, contextEstimated: true };
  }
  return {};
}
