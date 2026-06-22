/**
 * ContextBudget — the single source of truth for "how full is the prompt?".
 *
 * Consolidates what used to be ad-hoc math scattered across the compaction
 * path: resolving a model's discovered context window (with user overrides),
 * estimating the current prompt size, and classifying that into a level (ok / warn / trigger / critical) the reduction
 * engine and the UI both act on.
 *
 * Token estimate is best-effort and never blocks: exact BPE for the GPT family
 * (`tokenizeMessages`), an improving background-refined provider count for
 * Claude / Gemini (`tokenCountRemote`), and a chars/3.8 heuristic floor for
 * everything else.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import type { ContextManagementSettings } from '@shared/settings/agentBehaviorSettings.js';
import {
  resolveAdvertisedWindow,
  scaleContextBreakdown,
  summarizeContextUsage,
  summarizeContextUsageEstimatedWindow,
  summarizeContextUsageUnknownWindow,
  type ContextUsageBreakdown,
  type ContextUsageSummary
} from '@shared/context/contextLevel.js';
import {
  CONTEXT_CALIBRATION_MAX,
  CONTEXT_CALIBRATION_MIN
} from '@shared/constants.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import {
  tokenizeMessages,
  type TokenizableToolSchema
} from '../../providers/tokenCounter.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import {
  getCachedRemoteCount,
  providerSupportsRemoteCount,
  refineRemoteCount
} from '../../providers/tokenCountRemote.js';

export type { ContextUsageSummary } from '@shared/context/contextLevel.js';

function resolveAdvertisedWindowForProvider(
  provider: ProviderWithKey | null,
  modelId: string
): number {
  if (!provider) return 0;
  const model = findProviderModel(provider, modelId);
  return resolveAdvertisedWindow(model, provider.contextOverrides) ?? 0;
}

export interface EvaluateContextBudgetInput {
  messages: readonly ChatMessage[];
  modelId: string;
  providerId: string;
  settings: ContextManagementSettings;
  tools?: ReadonlyArray<TokenizableToolSchema>;
  /** Skip warming the background remote count (e.g. pure read-only probes). */
  skipRemoteRefine?: boolean;
  /**
   * Multiplicative correction derived from the provider's REAL reported
   * `usage.promptTokens` on a prior turn (real ÷ our estimate for that same
   * prompt). Anchors the local heuristic/BPE estimate to what the provider
   * actually billed, closing the 10–20% drift the chars/3.8 heuristic shows
   * on code/CJK. Omitted (or 1) ⇒ no correction.
   */
  calibrationRatio?: number;
}

/** Clamp the calibration ratio to a sane band so one anomalous turn can't skew the meter. */
export function normalizeCalibration(ratio: number | undefined): number {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(CONTEXT_CALIBRATION_MAX, Math.max(CONTEXT_CALIBRATION_MIN, ratio));
}

/**
 * Estimate current prompt size and classify it against the discovered window.
 * Pure read — never mutates `messages`. Fires a background remote-count
 * refresh (when the provider supports it and the local count is heuristic)
 * so the NEXT evaluation is more accurate; the current call still returns
 * immediately with the best value available now.
 */
export async function evaluateContextBudget(
  input: EvaluateContextBudgetInput
): Promise<ContextUsageSummary> {
  const provider = await getProviderWithKey(input.providerId);
  const model = provider ? findProviderModel(provider, input.modelId) : undefined;
  const contextEstimated = model?.contextEstimated === true;
  const advertisedWindow = resolveAdvertisedWindowForProvider(provider, input.modelId);
  const tools = input.tools ?? [];
  const remoteDialect =
    provider?.dialect === 'gemini-native' ? 'gemini-native' : 'anthropic-native';

  const base = tokenizeMessages(input.modelId, input.messages, tools);
  const ratio = normalizeCalibration(input.calibrationRatio);
  const calibrated = ratio !== 1;
  let usedTokens = Math.round(base.total * ratio);
  // Anchoring to real provider tokens makes the local estimate trustworthy.
  let exact = base.exact || calibrated;
  let breakdown = scaleContextBreakdown(base.breakdown, base.total, usedTokens);
  const visionTokens = base.visionTokens;

  // Provider count endpoints are text-only; native media tokens are tracked
  // separately via `tokenizeMessages().visionTokens` and added below.
  if (!base.exact && provider && providerSupportsRemoteCount(provider)) {
    const remote = getCachedRemoteCount(
      provider.id,
      input.modelId,
      input.messages,
      tools,
      visionTokens,
      remoteDialect
    );
    if (typeof remote === 'number' && remote > 0) {
      usedTokens = remote + visionTokens;
      exact = true;
      breakdown = scaleContextBreakdown(base.breakdown, base.total, remote + visionTokens);
    } else if (!input.skipRemoteRefine) {
      refineRemoteCount(provider, input.modelId, input.messages, tools, visionTokens);
    }
  }

  const usageBase = {
    usedTokens,
    exact,
    breakdown,
    ...(visionTokens > 0 ? { visionTokens } : {})
  };

  if (advertisedWindow <= 0) {
    return summarizeContextUsageUnknownWindow(usageBase);
  }

  if (contextEstimated) {
    return summarizeContextUsageEstimatedWindow({
      ...usageBase,
      advertisedWindow
    });
  }

  return summarizeContextUsage({
    ...usageBase,
    advertisedWindow,
    thresholds: {
      warnFraction: input.settings.warnFraction,
      triggerFraction: input.settings.triggerFraction
    }
  });
}

/**
 * Build a usage summary from an already-known token count + window, applying
 * the same compaction thresholds as {@link evaluateContextBudget}.
 * Synchronous — used by the reduction engine to report POST-reduction usage
 * without re-resolving the provider or re-tokenizing through the async path.
 */
export function buildUsageFromTokens(opts: {
  usedTokens: number;
  exact: boolean;
  advertisedWindow: number;
  settings: ContextManagementSettings;
  breakdown?: ContextUsageBreakdown;
  visionTokens?: number;
}): ContextUsageSummary {
  return summarizeContextUsage({
    usedTokens: opts.usedTokens,
    advertisedWindow: opts.advertisedWindow,
    thresholds: {
      warnFraction: opts.settings.warnFraction,
      triggerFraction: opts.settings.triggerFraction
    },
    exact: opts.exact,
    ...(opts.breakdown ? { breakdown: opts.breakdown } : {}),
    ...(opts.visionTokens != null && opts.visionTokens > 0
      ? { visionTokens: opts.visionTokens }
      : {})
  });
}

/**
 * Synchronous best-effort estimate (no network, no provider lookup) for hot
 * paths that already hold the provider/window. Used by the reduction engine
 * between in-turn swaps where re-resolving the provider would be wasteful.
 */
export function estimatePromptTokensSync(
  modelId: string,
  messages: readonly ChatMessage[],
  tools: ReadonlyArray<TokenizableToolSchema> = []
): { tokens: number; exact: boolean; breakdown: ContextUsageBreakdown; visionTokens: number } {
  const base = tokenizeMessages(modelId, messages, tools);
  return {
    tokens: base.total,
    exact: base.exact,
    breakdown: base.breakdown,
    visionTokens: base.visionTokens
  };
}
