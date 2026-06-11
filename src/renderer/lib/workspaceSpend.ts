/**
 * Workspace-level estimated API spend and run cost helpers.
 */

import { estimateRunCost, formatRunCostUsd } from '@shared/providers/estimateRunCost.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { findProviderModel } from '../components/composer/modelPicker/modelPickerContext.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

type TokenUsageSlice = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedPromptTokens?: number;
  cacheCreationTokens?: number;
};

/** Model selection persisted on the `user-prompt` row for this turn. */
export function resolveModelForPrompt(
  events: readonly TimelineEvent[],
  promptId: string,
  fallback: ModelSelection | null
): ModelSelection | null {
  for (const e of events) {
    if (
      e.kind === 'user-prompt' &&
      e.id === promptId &&
      typeof e.providerId === 'string' &&
      e.providerId.length > 0 &&
      typeof e.modelId === 'string' &&
      e.modelId.length > 0
    ) {
      return { providerId: e.providerId, modelId: e.modelId };
    }
  }
  return fallback;
}

function resolveModelPricing(
  model: ModelSelection | null,
  providers: ProviderConfig[]
) {
  if (!model) return undefined;
  const provider = providers.find((p) => p.id === model.providerId);
  return provider ? findProviderModel(provider, model.modelId)?.pricing : undefined;
}

export function estimateRunCostUsd(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): number | null {
  const est = estimateRunCost(usage, resolveModelPricing(model, providers));
  if (!est || est.totalUsd <= 0) return null;
  return est.totalUsd;
}

export function estimateCostForUsage(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): string | null {
  const usd = estimateRunCostUsd(model, providers, usage);
  if (usd === null) return null;
  return formatRunCostUsd(usd);
}

const recordedPromptSpend = new Set<string>();

/** Record spend once per workspace + prompt (survives row remount / virtualization). */
export async function recordWorkspaceSpendForPrompt(
  workspaceId: string | null | undefined,
  promptId: string,
  usd: number
): Promise<void> {
  if (!workspaceId || !promptId || !Number.isFinite(usd) || usd <= 0) return;
  const key = `${workspaceId}::${promptId}`;
  if (recordedPromptSpend.has(key)) return;
  recordedPromptSpend.add(key);
  await useSettingsStore.getState().addWorkspaceSpend(workspaceId, usd);
}

/** Test-only reset. */
export function __test_resetRecordedPromptSpend(): void {
  recordedPromptSpend.clear();
}

export function formatWorkspaceSpend(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd >= 1) return `$${usd.toFixed(2)} spent`;
  if (usd >= 0.01) return `$${usd.toFixed(3)} spent`;
  return `$${usd.toFixed(4)} spent`;
}
