/**
 * Workspace-level estimated API spend and run cost helpers.
 */

import {
  estimateRunCost,
  formatComposerCostUsd,
  formatRunCostUsd,
  type RunCostEstimate
} from '@shared/providers/estimateRunCost.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { findProviderModel } from '../components/composer/modelPicker/modelPickerContext.js';
import { useConversationsStore } from '../store/useConversationsStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { vyotiq } from './ipc.js';
import type { TokenUsageAggregate } from '../components/timeline/reducer/types.js';

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

export function estimateRunCostBreakdown(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): RunCostEstimate | null {
  const est = estimateRunCost(usage, resolveModelPricing(model, providers));
  if (!est || est.totalUsd <= 0) return null;
  return est;
}

export function estimateRunCostUsd(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): number | null {
  const est = estimateRunCostBreakdown(model, providers, usage);
  return est?.totalUsd ?? null;
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

export function estimateComposerCostForUsage(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): string | null {
  const usd = estimateRunCostUsd(model, providers, usage);
  if (usd === null) return null;
  return formatComposerCostUsd(usd);
}

/** Last-turn cumulative cost for the composer pill (includes in-flight estimate). */
export function resolveLiveTurnCost(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  orchestratorUsage: TokenUsageAggregate | undefined
): { usd: number; label: string; breakdown: RunCostEstimate } | null {
  if (!orchestratorUsage) return null;
  const usage = orchestratorUsage.inFlight ?? orchestratorUsage.latest;
  const est = estimateRunCostBreakdown(model, providers, usage);
  if (!est) return null;
  return {
    usd: est.totalUsd,
    label: formatComposerCostUsd(est.totalUsd),
    breakdown: est
  };
}

const recordedPromptSpend = new Set<string>();

/** Record workspace + conversation spend once per prompt turn. */
export async function recordRunSpendForPrompt(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
  promptId: string,
  usd: number
): Promise<void> {
  if (!promptId || !Number.isFinite(usd) || usd <= 0) return;

  if (workspaceId) {
    const wsKey = `ws::${workspaceId}::${promptId}`;
    if (!recordedPromptSpend.has(wsKey)) {
      recordedPromptSpend.add(wsKey);
      await useSettingsStore.getState().addWorkspaceSpend(workspaceId, usd);
    }
  }

  if (conversationId) {
    const convKey = `conv::${conversationId}::${promptId}`;
    if (!recordedPromptSpend.has(convKey)) {
      recordedPromptSpend.add(convKey);
      const meta = await vyotiq.conversations.incrementSpend(conversationId, promptId, usd);
      if (meta) {
        useConversationsStore.getState().patchMeta(meta);
      }
    }
  }
}

/** @deprecated Use `recordRunSpendForPrompt`. */
export async function recordWorkspaceSpendForPrompt(
  workspaceId: string | null | undefined,
  promptId: string,
  usd: number
): Promise<void> {
  await recordRunSpendForPrompt(workspaceId, null, promptId, usd);
}

/** Test-only reset. */
export function __test_resetRecordedPromptSpend(): void {
  recordedPromptSpend.clear();
}

export function formatWorkspaceSpend(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  return `${formatComposerCostUsd(usd)} spent`;
}

export function formatConversationSpend(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  return formatComposerCostUsd(usd);
}
