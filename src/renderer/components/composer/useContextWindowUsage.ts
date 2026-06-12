/**
 * Resolves the current context-window usage for the composer meter.
 *
 * Prefers the live, authoritative `context-usage` telemetry from the active
 * run (main computed it against the real effective window). Between runs / on
 * replay it falls back to a derived estimate from the last persisted prompt
 * tokens and the selected model's window so the meter is always meaningful.
 */

import { useMemo } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import {
  summarizeContextUsage,
  type ContextUsageSummary
} from '@shared/context/contextLevel.js';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { findProviderModel, rowContextTokens } from './modelPicker/modelPickerContext.js';

export function useContextWindowUsage(
  model: ModelSelection | null
): ContextUsageSummary | null {
  const latest = useChatStore((s) => s.latestContextUsage);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);
  const providers = useProviderStore((s) => s.providers);
  const ui = useSettingsStore((s) => s.settings.ui);

  return useMemo(() => {
    // Live, authoritative value from the active run.
    if (latest && latest.effectiveWindow > 0) {
      return {
        usedTokens: latest.usedTokens,
        advertisedWindow: latest.advertisedWindow,
        effectiveWindow: latest.effectiveWindow,
        fractionUsed: latest.usedTokens / latest.effectiveWindow,
        level: latest.level,
        exact: latest.exact,
        ...(latest.byPart ? { byPart: latest.byPart } : {})
      };
    }

    // At-rest fallback: last persisted prompt tokens vs. the model window.
    if (!model) return null;
    const provider = providers.find((p) => p.id === model.providerId);
    if (!provider) return null;
    const info = findProviderModel(provider, model.modelId);
    const advertised = info ? rowContextTokens(info, provider) : undefined;
    if (!advertised || advertised <= 0) return null;
    // `used` may be 0 on a fresh chat — the meter still renders at 0% so it is
    // always visible and fills as the conversation grows.
    const used = orchestratorUsage?.latest?.promptTokens ?? 0;

    const cm = resolveAgentBehaviorSettings(ui).contextManagement;
    return summarizeContextUsage({
      usedTokens: used,
      advertisedWindow: advertised,
      effectiveWindowFraction: cm.effectiveWindowFraction,
      thresholds: { warnFraction: cm.warnFraction, triggerFraction: cm.triggerFraction },
      exact: false
    });
  }, [latest, orchestratorUsage, providers, ui, model]);
}
