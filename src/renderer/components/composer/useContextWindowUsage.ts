/**

 * Resolves the current context-window usage for the composer meter.

 *

 * During an active run, prefers live `context-usage` telemetry from main.

 * Between runs, calls `context:evaluate` so the meter includes the static

 * prefix (harness, workspace, tools) — not just last-turn tokens.

 */



import { useEffect, useMemo, useRef, useState } from 'react';

import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';

import { summarizeContextUsage, summarizeContextUsageUnknownWindow, type ContextUsageSummary } from '@shared/context/contextLevel.js';

import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';

import { useChatStore } from '../../store/useChatStore.js';

import { useProviderStore } from '../../store/useProviderStore.js';

import { useSettingsStore } from '../../store/useSettingsStore.js';

import { findProviderModel, rowContextTokens } from './modelPicker/modelPickerContext.js';

import {

  evaluationScopeKey,

  liveUsageMatchesModel,

  liveUsageWindowMatchesDiscovered,

  resolveLiveAdvertisedWindow,

  summarizeLiveContextUsage

} from './contextMeterLevel.js';

import { vyotiq } from '../../lib/ipc.js';



const EVAL_DEBOUNCE_MS = 320;



export interface ContextWindowUsageState {

  usage: ContextUsageSummary | null;

  /** True while an idle `context:evaluate` request is in flight. */

  evaluating: boolean;

}



interface UseContextWindowUsageInput {

  model: ModelSelection | null;

  conversationId: string | null;

  workspaceId: string | null;

  draftPrompt: string;

  attachmentDraft: PromptAttachmentMeta[];

  isRunActive: boolean;

}



function contextSettingsFingerprint(

  ui: ReturnType<typeof useSettingsStore.getState>['settings']['ui']

): string {

  const cm = resolveAgentBehaviorSettings(ui).contextManagement;

  return [cm.warnFraction, cm.triggerFraction].join(':');

}



export function useContextWindowUsage({

  model,

  conversationId,

  workspaceId,

  draftPrompt,

  attachmentDraft,

  isRunActive

}: UseContextWindowUsageInput): ContextWindowUsageState {

  const latest = useChatStore((s) => s.latestContextUsage);

  const eventCount = useChatStore((s) => s.events.length);

  const providers = useProviderStore((s) => s.providers);

  const ui = useSettingsStore((s) => s.settings.ui);

  const [evaluated, setEvaluated] = useState<ContextUsageSummary | null>(null);

  const [evaluating, setEvaluating] = useState(false);

  const requestIdRef = useRef(0);

  const evaluatedScopeRef = useRef<string | null>(null);



  const settingsKey = useMemo(() => contextSettingsFingerprint(ui), [ui]);

  const cm = useMemo(() => resolveAgentBehaviorSettings(ui).contextManagement, [ui]);



  const currentAdvertised = useMemo((): number | undefined => {

    if (!model) return undefined;

    const provider = providers.find((p) => p.id === model.providerId);

    if (!provider) return undefined;

    const info = findProviderModel(provider, model.modelId);

    return info ? rowContextTokens(info, provider) : undefined;

  }, [model, providers]);



  const thresholds = useMemo(

    () => ({ warnFraction: cm.warnFraction, triggerFraction: cm.triggerFraction }),

    [cm.warnFraction, cm.triggerFraction]

  );



  const liveUsage = useMemo((): ContextUsageSummary | null => {

    if (!latest || !model) return null;

    if (!liveUsageMatchesModel(latest, model, isRunActive)) return null;



    if (

      !isRunActive &&

      currentAdvertised !== undefined &&

      currentAdvertised > 0 &&

      !liveUsageWindowMatchesDiscovered(latest, currentAdvertised)

    ) {

      return null;

    }



    return summarizeLiveContextUsage(latest, {

      advertisedWindow: resolveLiveAdvertisedWindow(latest, currentAdvertised),

      thresholds

    });

  }, [latest, model, isRunActive, currentAdvertised, thresholds]);



  const evaluationScope = useMemo(() => {

    if (!model || !workspaceId) return null;

    return evaluationScopeKey({

      model,

      workspaceId,

      conversationId,

      settingsKey,

      contextWindow: currentAdvertised

    });

  }, [model, workspaceId, conversationId, settingsKey, currentAdvertised]);



  useEffect(() => {

    if (isRunActive || !model || !workspaceId || !evaluationScope) {

      setEvaluated(null);

      setEvaluating(false);

      evaluatedScopeRef.current = null;

      return;

    }



    if (evaluatedScopeRef.current !== evaluationScope) {

      setEvaluated(null);

    }



    const requestId = ++requestIdRef.current;

    setEvaluating(true);

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

            evaluatedScopeRef.current = evaluationScope;

            setEvaluated(reply.usage);

          } else {

            setEvaluated(null);

            evaluatedScopeRef.current = null;

          }

        } catch {

          if (requestIdRef.current !== requestId) return;

          setEvaluated(null);

          evaluatedScopeRef.current = null;

        } finally {

          if (requestIdRef.current === requestId) setEvaluating(false);

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

    eventCount,

    evaluationScope

  ]);



  useEffect(() => () => {

    requestIdRef.current += 1;

  }, []);



  const usage = useMemo((): ContextUsageSummary | null => {

    if (isRunActive && liveUsage) return liveUsage;



    if (

      evaluated &&

      evaluationScope !== null &&

      evaluatedScopeRef.current === evaluationScope

    ) {

      return evaluated;

    }



    if (!isRunActive && liveUsage) return liveUsage;



    if (!model) return null;

    const provider = providers.find((p) => p.id === model.providerId);

    if (!provider) return null;

    const info = findProviderModel(provider, model.modelId);

    const advertised = info ? rowContextTokens(info, provider) : undefined;

    if (!advertised || advertised <= 0) {

      return summarizeContextUsageUnknownWindow({ usedTokens: 0, exact: false });

    }



    return summarizeContextUsage({

      usedTokens: 0,

      advertisedWindow: advertised,

      thresholds,

      exact: false

    });

  }, [isRunActive, liveUsage, evaluated, evaluationScope, model, providers, thresholds]);



  const pending =

    evaluating && !isRunActive && Boolean(model) && Boolean(workspaceId);



  return { usage, evaluating: pending };

}


