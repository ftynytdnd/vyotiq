/**
 * Approximate run cost from token usage + per-model pricing.
 */

import {
  ANTHROPIC_CACHE_WRITE_MULTIPLIER,
  CACHE_READ_INPUT_MULTIPLIER
} from './cachePricingDefaults.js';
import type { ModelPricing } from './modelPricing.js';
import type { TokenUsage } from '../types/chat.js';

export interface RunCostEstimate {
  /** Total estimated USD for the usage slice. */
  totalUsd: number;
  inputUsd: number;
  outputUsd: number;
  reasoningUsd: number;
  cachedInputUsd: number;
  /** Anthropic-only: USD for cache-write tokens this turn. */
  cacheWriteUsd: number;
  perRequestUsd: number;
}

type UsageSlice = Pick<
  TokenUsage,
  'promptTokens' | 'completionTokens' | 'reasoningTokens' | 'cachedPromptTokens' | 'cacheCreationTokens'
>;

/**
 * Split input tokens into billable buckets.
 * Anthropic reports tail (`promptTokens`), reads, and writes separately;
 * OpenAI-compat providers embed cached tokens inside `promptTokens`.
 */
function billInputBuckets(usage: UsageSlice): {
  tailTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
} {
  const cached = usage.cachedPromptTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  const prompt = usage.promptTokens;

  if (cacheWrite > 0 || cached > prompt) {
    return { tailTokens: prompt, cachedTokens: cached, cacheWriteTokens: cacheWrite };
  }
  return {
    tailTokens: Math.max(0, prompt - cached),
    cachedTokens: cached,
    cacheWriteTokens: 0
  };
}

/** Estimate USD cost for a token usage record and model pricing. */
export function estimateRunCost(
  usage: UsageSlice,
  pricing: ModelPricing | undefined,
  requestCount = 1
): RunCostEstimate | null {
  if (!pricing) return null;

  const inputRate = pricing.inputPerMillion ?? 0;
  const outputRate = pricing.outputPerMillion ?? 0;
  const cachedRate =
    pricing.cachedInputPerMillion !== undefined && pricing.cachedInputPerMillion > 0
      ? pricing.cachedInputPerMillion
      : inputRate * CACHE_READ_INPUT_MULTIPLIER;
  const cacheWriteRate =
    pricing.cacheWriteInputPerMillion !== undefined && pricing.cacheWriteInputPerMillion > 0
      ? pricing.cacheWriteInputPerMillion
      : inputRate * ANTHROPIC_CACHE_WRITE_MULTIPLIER;
  const reasoningRate = pricing.reasoningPerMillion ?? outputRate;

  const { tailTokens, cachedTokens, cacheWriteTokens } = billInputBuckets(usage);
  const tailUsd = (tailTokens / 1_000_000) * inputRate;
  const cachedInputUsd = (cachedTokens / 1_000_000) * cachedRate;
  const cacheWriteUsd =
    cacheWriteTokens > 0 ? (cacheWriteTokens / 1_000_000) * cacheWriteRate : 0;
  const completionBillable = Math.max(
    0,
    usage.completionTokens - (usage.reasoningTokens ?? 0)
  );
  const outputUsd = (completionBillable / 1_000_000) * outputRate;
  const reasoningUsd =
    usage.reasoningTokens && usage.reasoningTokens > 0
      ? (usage.reasoningTokens / 1_000_000) * reasoningRate
      : 0;
  const perRequestUsd = (pricing.perRequest ?? 0) * Math.max(1, requestCount);

  const totalUsd =
    tailUsd + cachedInputUsd + cacheWriteUsd + outputUsd + reasoningUsd + perRequestUsd;
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
    if (perRequestUsd <= 0 && inputRate === 0 && outputRate === 0) return null;
  }

  return {
    totalUsd,
    inputUsd: tailUsd + cachedInputUsd + cacheWriteUsd,
    outputUsd,
    reasoningUsd,
    cachedInputUsd,
    cacheWriteUsd,
    perRequestUsd
  };
}

/** Compact USD label for UI, e.g. `$0.042` or `$1.23`. */
export function formatRunCostUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd >= 0.0001) return `$${usd.toFixed(4)}`;
  if (usd > 0) return '<$0.0001';
  return '$0.00';
}
