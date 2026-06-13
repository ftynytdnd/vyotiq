/**
 * Workspace-level estimated API spend and run cost helpers.
 */

import {
  estimateRunCost,
  formatComposerCostUsd,
  formatRunCostUsd,
  type RunCostEstimate
} from '@shared/providers/estimateRunCost.js';
import { OPENROUTER_PLATFORM_FEE_MULTIPLIER } from '@shared/providers/cacheSavings.js';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { findProviderModel } from '../components/composer/modelPicker/modelPickerContext.js';
import { useConversationsStore } from '../store/useConversationsStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { vyotiq } from './ipc.js';
import type { TurnUsageStatsDelta, WorkspaceSpendEntry, WorkspaceSpendStats } from '@shared/types/usageStats.js';
import { normalizeWorkspaceSpendEntry } from '@shared/types/usageStats.js';
import { useSessionStatsStore } from '../store/useSessionStatsStore.js';
import type { TokenUsageAggregate } from '../components/timeline/reducer/types.js';

type TokenUsageSlice = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedPromptTokens?: number;
  cacheCreationTokens?: number;
  uncachedPromptTokens?: number;
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

function resolvePlatformFeeMultiplier(
  model: ModelSelection | null,
  providers: ProviderConfig[]
): number {
  if (!model) return 1;
  const provider = providers.find((p) => p.id === model.providerId);
  if (!provider) return 1;
  return classifyProviderHost(provider) === 'openrouter'
    ? OPENROUTER_PLATFORM_FEE_MULTIPLIER
    : 1;
}

export function estimateRunCostBreakdown(
  model: ModelSelection | null,
  providers: ProviderConfig[],
  usage: TokenUsageSlice
): RunCostEstimate | null {
  const est = estimateRunCost(usage, resolveModelPricing(model, providers), 1, {
    platformFeeMultiplier: resolvePlatformFeeMultiplier(model, providers)
  });
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
): { usd: number; label: string; breakdown: RunCostEstimate; partial: boolean } | null {
  if (!orchestratorUsage) return null;
  const partial = orchestratorUsage.inFlight !== undefined;
  const usage = orchestratorUsage.inFlight ?? orchestratorUsage.latest;
  const est = estimateRunCostBreakdown(model, providers, usage);
  if (!est) return null;
  const baseLabel = formatComposerCostUsd(est.totalUsd);
  return {
    usd: est.totalUsd,
    label: partial ? `${baseLabel} (partial)` : baseLabel,
    breakdown: est,
    partial
  };
}

/** Build per-turn stats delta from usage and cost breakdown. */
export function buildTurnUsageStatsDelta(
  usage: TokenUsageSlice,
  breakdown: RunCostEstimate | null
): TurnUsageStatsDelta {
  const cached = usage.cachedPromptTokens ?? 0;
  const prompt = usage.promptTokens;
  return {
    netCacheSavingsUsd:
      breakdown && breakdown.netCacheSavingsUsd > 0 ? breakdown.netCacheSavingsUsd : undefined,
    cachedTokens: cached > 0 ? cached : undefined,
    reasoningTokens:
      usage.reasoningTokens && usage.reasoningTokens > 0 ? usage.reasoningTokens : undefined,
    lastCacheHitPct:
      prompt > 0 && cached > 0 ? Math.round((cached / prompt) * 100) : undefined
  };
}

const recordedPromptSpend = new Set<string>();

/** Record workspace + conversation spend once per prompt turn. */
export async function recordRunSpendForPrompt(
  workspaceId: string | null | undefined,
  conversationId: string | null | undefined,
  promptId: string,
  usd: number,
  stats: TurnUsageStatsDelta = {}
): Promise<void> {
  if (!promptId || !Number.isFinite(usd) || usd <= 0) return;

  if (workspaceId) {
    const wsKey = `ws::${workspaceId}::${promptId}`;
    if (!recordedPromptSpend.has(wsKey)) {
      recordedPromptSpend.add(wsKey);
      await useSettingsStore.getState().addWorkspaceUsage(workspaceId, usd, stats);
    }
  }

  if (conversationId) {
    const convKey = `conv::${conversationId}::${promptId}`;
    if (!recordedPromptSpend.has(convKey)) {
      recordedPromptSpend.add(convKey);
      const meta = await vyotiq.conversations.incrementSpend(
        conversationId,
        promptId,
        usd,
        stats
      );
      if (meta) {
        useConversationsStore.getState().patchMeta(meta);
      }
    }
  }

  const sessionKey = `session::${promptId}`;
  if (!recordedPromptSpend.has(sessionKey)) {
    recordedPromptSpend.add(sessionKey);
    useSessionStatsStore.getState().recordTurn(usd, stats);
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

export function formatWorkspaceSpend(
  entry: WorkspaceSpendEntry | WorkspaceSpendStats | undefined
): string | null {
  const stats = normalizeWorkspaceSpendEntry(entry);
  if (stats.spendUsd <= 0) return null;
  return `${formatComposerCostUsd(stats.spendUsd)} spent`;
}

export function formatConversationSpend(usd: number | undefined): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  return formatComposerCostUsd(usd);
}
