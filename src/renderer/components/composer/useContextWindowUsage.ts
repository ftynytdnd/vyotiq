/**
 * Resolves the current context-window usage for the composer meter.
 *
 * During an active run, prefers live `context-usage` telemetry from main.
 * Between runs, calls `context:evaluate` so the meter includes the static
 * prefix (harness, few-shot, workspace, tools) — not just last-turn tokens.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  summarizeContextUsage,
  type ContextUsageSummary
} from '@shared/context/contextLevel.js';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { findProviderModel, rowContextTokens } from './modelPicker/modelPickerContext.js';
import { vyotiq } from '../../lib/ipc.js';

const EVAL_DEBOUNCE_MS = 320;

interface UseContextWindowUsageInput {
  model: ModelSelection | null;
  conversationId: string | null;
  workspaceId: string | null;
  draftPrompt: string;
  attachmentDraft: PromptAttachmentMeta[];
  /** True while a run is active — live telemetry wins over idle evaluate. */
  isRunActive: boolean;
}

export function useContextWindowUsage({
  model,
  conversationId,
  workspaceId,
  draftPrompt,
  attachmentDraft,
  isRunActive
}: UseContextWindowUsageInput): ContextUsageSummary | null {
  const latest = useChatStore((s) => s.latestContextUsage);
  const eventCount = useChatStore((s) => s.events.length);
  const providers = useProviderStore((s) => s.providers);
  const ui = useSettingsStore((s) => s.settings.ui);
  const [evaluated, setEvaluated] = useState<ContextUsageSummary | null>(null);
  const requestIdRef = useRef(0);

  const liveUsage = useMemo((): ContextUsageSummary | null => {
    if (!latest || latest.effectiveWindow <= 0) return null;
    return {
      usedTokens: latest.usedTokens,
      advertisedWindow: latest.advertisedWindow,
      effectiveWindow: latest.effectiveWindow,
      fractionUsed: latest.usedTokens / latest.effectiveWindow,
      level: latest.level,
      exact: latest.exact,
      ...(latest.breakdown ? { breakdown: latest.breakdown } : {})
    };
  }, [latest]);

  useEffect(() => {
    if (isRunActive || !model || !workspaceId) {
      setEvaluated(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const reply = await vyotiq.context.evaluate({
            workspaceId,
            selection: { providerId: model.providerId, modelId: model.modelId },
            ...(conversationId ? { conversationId } : {}),
            ...(draftPrompt.trim().length > 0 ? { draftPrompt } : {}),
            ...(attachmentDraft.length > 0 ? { draftAttachmentMeta: attachmentDraft } : {})
          });
          if (requestIdRef.current !== requestId) return;
          if (reply.ok) {
            setEvaluated(reply.usage);
          } else {
            setEvaluated(null);
          }
        } catch {
          if (requestIdRef.current !== requestId) return;
          setEvaluated(null);
        }
      })();
    }, EVAL_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    isRunActive,
    model,
    workspaceId,
    conversationId,
    draftPrompt,
    attachmentDraft,
    eventCount
  ]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  if (isRunActive && liveUsage) {
    return liveUsage;
  }

  if (evaluated && evaluated.effectiveWindow > 0) {
    return evaluated;
  }

  if (!isRunActive && liveUsage) {
    return liveUsage;
  }

  // Last-resort fallback when evaluate IPC is unavailable (e.g. tests).
  if (!model) return null;
  const provider = providers.find((p) => p.id === model.providerId);
  if (!provider) return null;
  const info = findProviderModel(provider, model.modelId);
  const advertised = info ? rowContextTokens(info, provider) : undefined;
  if (!advertised || advertised <= 0) return null;

  const cm = resolveAgentBehaviorSettings(ui).contextManagement;
  return summarizeContextUsage({
    usedTokens: 0,
    advertisedWindow: advertised,
    effectiveWindowFraction: cm.effectiveWindowFraction,
    thresholds: { warnFraction: cm.warnFraction, triggerFraction: cm.triggerFraction },
    exact: false
  });
}
