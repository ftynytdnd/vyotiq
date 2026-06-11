/**
 * 2026 prompt-cache billing multipliers (tiered by host + model family).
 * Applied when discovery rows omit explicit cache-read pricing.
 */

import type { ModelPricing } from './modelPricing.js';
import type { ProviderHostKind } from './providerHostKind.js';

/** Legacy export — GPT-5 / Anthropic / DeepSeek tier (90% off). */
export const CACHE_READ_INPUT_MULTIPLIER = 0.1;

/** Anthropic 5-minute TTL cache write surcharge. */
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25;

const AUTO_CACHE_HOSTS: ReadonlySet<ProviderHostKind> = new Set([
  'openai',
  'anthropic',
  'deepseek',
  'gemini',
  'groq',
  'xai',
  'openrouter'
]);

/**
 * Model-family cache-read multiplier when upstream omits `cachedInputPerMillion`.
 * @see https://developers.openai.com/cookbook/examples/prompt_caching_201
 * @see https://ai.google.dev/gemini-api/docs/caching
 */
export function resolveCacheReadMultiplier(
  hostKind: ProviderHostKind,
  modelId: string
): number {
  const id = modelId.toLowerCase();

  if (hostKind === 'openrouter') {
    if (id.includes('claude') || id.includes('deepseek') || id.includes('gemini')) {
      return id.includes('gemini') ? 0.25 : 0.1;
    }
  }

  if (hostKind === 'openai' || hostKind === 'openrouter') {
    if (id.startsWith('gpt-5') || id.startsWith('o3') || id.startsWith('o4')) {
      return 0.1;
    }
    if (id.startsWith('gpt-4.1')) {
      return 0.25;
    }
    if (id.startsWith('gpt-4o')) {
      return 0.5;
    }
    return 0.5;
  }

  if (hostKind === 'gemini') {
    return 0.25;
  }

  return CACHE_READ_INPUT_MULTIPLIER;
}

/** Attach default cache-read (and Anthropic write) rates when upstream omits them. */
export function withPromptCachePricingDefaults(
  hostKind: ProviderHostKind,
  pricing: ModelPricing | undefined,
  modelId = ''
): ModelPricing | undefined {
  if (!pricing || !AUTO_CACHE_HOSTS.has(hostKind)) return pricing;
  const input = pricing.inputPerMillion;
  if (input === undefined || input <= 0) return pricing;

  const out: ModelPricing = { ...pricing };
  if (out.cachedInputPerMillion === undefined || out.cachedInputPerMillion <= 0) {
    const mult = resolveCacheReadMultiplier(hostKind, modelId);
    out.cachedInputPerMillion = input * mult;
  }
  if (
    hostKind === 'anthropic' &&
    (out.cacheWriteInputPerMillion === undefined || out.cacheWriteInputPerMillion <= 0)
  ) {
    out.cacheWriteInputPerMillion = input * ANTHROPIC_CACHE_WRITE_MULTIPLIER;
  }
  return out;
}
