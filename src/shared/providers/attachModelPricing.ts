/**
 * Attach parsed or curated pricing to a discovered model row.
 */

import type { ModelInfo, ProviderWithKey } from '../types/provider.js';
import { parseModelPricingFromRow } from './modelPricing.js';
import { classifyProviderHost } from './providerHostKind.js';
import { withPromptCachePricingDefaults } from './cachePricingDefaults.js';
import { enrichModelPricing } from './hostModelPricing.js';

/** Merge API pricing with host-specific fallback tables. */
export function attachModelPricing(
  provider: ProviderWithKey,
  modelId: string,
  rawRow?: unknown
): ModelInfo['pricing'] {
  const hostKind = classifyProviderHost(provider);
  const fromApi = rawRow !== undefined ? parseModelPricingFromRow(rawRow) : undefined;
  const merged = enrichModelPricing(hostKind, modelId, fromApi);
  return withPromptCachePricingDefaults(hostKind, merged, modelId);
}
