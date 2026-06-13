/**
 * Prompt-cache savings estimates (gross vs net after write surcharge).
 */

import {
  ANTHROPIC_CACHE_WRITE_MULTIPLIER,
  CACHE_READ_INPUT_MULTIPLIER
} from './cachePricingDefaults.js';
import type { ModelPricing } from './modelPricing.js';
import type { TokenUsage } from '../types/chat.js';

/** OpenRouter credit-purchase platform fee (5.5%). Applied to inference estimates. */
export const OPENROUTER_PLATFORM_FEE_MULTIPLIER = 1.055;

export interface CacheSavingsEstimate {
  /** USD saved vs billing all cached tokens at full input rate. */
  grossSavingsUsd: number;
  /** Gross minus cache-write surcharge on the same turn. */
  netSavingsUsd: number;
}

type UsageSlice = Pick<
  TokenUsage,
  'cachedPromptTokens' | 'cacheCreationTokens' | 'promptTokens'
>;

function resolveCachedRate(pricing: ModelPricing, inputRate: number): number {
  return pricing.cachedInputPerMillion !== undefined && pricing.cachedInputPerMillion > 0
    ? pricing.cachedInputPerMillion
    : inputRate * CACHE_READ_INPUT_MULTIPLIER;
}

function resolveCacheWriteRate(pricing: ModelPricing, inputRate: number): number {
  return pricing.cacheWriteInputPerMillion !== undefined &&
    pricing.cacheWriteInputPerMillion > 0
    ? pricing.cacheWriteInputPerMillion
    : inputRate * ANTHROPIC_CACHE_WRITE_MULTIPLIER;
}

/** Estimate cache savings for a usage slice and model pricing. */
export function estimateCacheSavings(
  usage: UsageSlice,
  pricing: ModelPricing | undefined,
  platformFeeMultiplier = 1
): CacheSavingsEstimate | null {
  if (!pricing) return null;

  const cachedTokens = usage.cachedPromptTokens ?? 0;
  if (cachedTokens <= 0) {
    return { grossSavingsUsd: 0, netSavingsUsd: 0 };
  }

  const inputRate = pricing.inputPerMillion ?? 0;
  if (inputRate <= 0) return null;

  const cachedRate = resolveCachedRate(pricing, inputRate);
  const grossSavingsUsd =
    (cachedTokens / 1_000_000) * Math.max(0, inputRate - cachedRate);

  const cacheWriteTokens = usage.cacheCreationTokens ?? 0;
  const cacheWriteUsd =
    cacheWriteTokens > 0
      ? (cacheWriteTokens / 1_000_000) * resolveCacheWriteRate(pricing, inputRate)
      : 0;

  const netSavingsUsd = grossSavingsUsd - cacheWriteUsd;

  if (platformFeeMultiplier !== 1) {
    return {
      grossSavingsUsd: grossSavingsUsd * platformFeeMultiplier,
      netSavingsUsd: netSavingsUsd * platformFeeMultiplier
    };
  }

  return { grossSavingsUsd, netSavingsUsd };
}

/** Format a compact savings label for composer strip, e.g. `saved ~$0.003`. */
export function formatCacheSavingsUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '';
  if (usd >= 1) return `saved ~$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `saved ~$${usd.toFixed(3)}`;
  if (usd >= 0.0001) return `saved ~$${usd.toFixed(4)}`;
  return 'saved <$0.0001';
}
