/**
 * Prompt-cache telemetry for the composer metrics row.
 */

import type { ModelSelection } from '@shared/types/provider.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { providerDialectReportsPromptCache } from '@shared/providers/promptCacheMetrics.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { formatComposerCostUsd } from '@shared/providers/estimateRunCost.js';
import { formatCacheSavingsUsd } from '@shared/providers/cacheSavings.js';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import { estimateRunCostBreakdown } from '../../lib/workspaceSpend.js';

export interface ComposerCacheStats {
  cacheWarn: boolean;
  title: string;
  cachedTokens: number;
  promptTokens: number;
  cachePct: number | null;
  grossSavingsLabel: string;
  uncachedLabel: string | null;
}

export function useComposerCacheStats(model: ModelSelection | null): ComposerCacheStats | null {
  const providers = useProviderStore((s) => s.providers);
  const provider = model ? providers.find((p) => p.id === model.providerId) : undefined;
  const providerDialect = provider?.dialect;
  const reportsPromptCache =
    providerDialect !== undefined && providerDialectReportsPromptCache(providerDialect);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);
  const isProcessing = useChatStore((s) => s.isProcessing);

  const latest = orchestratorUsage?.latest;
  const cached = latest?.cachedPromptTokens ?? 0;
  const uncached = latest?.uncachedPromptTokens ?? 0;
  const prompt = latest?.promptTokens ?? 0;
  const isDeepSeek =
    provider !== undefined && classifyProviderHost(provider) === 'deepseek';
  const multiTurn = (orchestratorUsage?.samples ?? 0) > 1;
  const cacheWarn = Boolean(reportsPromptCache && multiTurn && cached === 0 && prompt >= 1024);
  const cachePct = prompt > 0 && cached > 0 ? Math.round((cached / prompt) * 100) : null;
  const showCacheLine = (isProcessing || multiTurn) && (cached > 0 || cacheWarn);

  if (!showCacheLine || !latest) return null;

  const costBreakdown =
    model && latest ? estimateRunCostBreakdown(model, providers, latest) : null;
  const grossSavingsLabel =
    costBreakdown && costBreakdown.grossCacheSavingsUsd > 0
      ? formatCacheSavingsUsd(costBreakdown.grossCacheSavingsUsd)
      : '';
  const netSavingsUsd = costBreakdown?.netCacheSavingsUsd ?? 0;

  const sessionHint =
    'Conversation session — last LLM turn cache stats (cumulative usage in Settings → Usage)';
  const title = cacheWarn
    ? 'No prompt cache hits on this turn — prefix may have changed'
    : netSavingsUsd > 0
      ? `${sessionHint}\nNet cache savings this turn: ${formatComposerCostUsd(netSavingsUsd)} (after write surcharge)`
      : sessionHint;

  return {
    cacheWarn,
    title,
    cachedTokens: cached,
    promptTokens: prompt,
    cachePct,
    grossSavingsLabel,
    uncachedLabel:
      isDeepSeek && uncached > 0 ? `${formatTokenCountWithUnit(uncached)} uncached` : null
  };
}
