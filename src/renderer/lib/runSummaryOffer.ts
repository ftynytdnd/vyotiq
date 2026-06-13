/**
 * Eligibility + payload assembly for auto-generated run summary reports.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { GenerateRunSummaryInput } from '@shared/types/ipc.js';
import { clipRunSummaryPromptPreview } from '@shared/report/deliverables.js';
import {
  collectRunFileEdits,
  resolveRunEditWindowFromRunId,
  runHadReport,
  runWindowEvents,
  shouldOfferRunSummary,
  type RunEditWindow
} from '@shared/report/runEligibility.js';
import { foldTokenUsage } from '../components/timeline/reducer/types.js';
import { estimateRunCostUsd, resolveModelForPrompt } from './workspaceSpend.js';
import type { ProviderConfig } from '@shared/types/provider.js';

export type { RunEditWindow as RunSummaryOfferContext };

export {
  collectRunFileEdits,
  runHadReport,
  shouldOfferRunSummary
};

function promptEvent(
  events: TimelineEvent[],
  promptId: string
): Extract<TimelineEvent, { kind: 'user-prompt' }> | null {
  const found = events.find((e) => e.kind === 'user-prompt' && e.id === promptId);
  return found?.kind === 'user-prompt' ? found : null;
}

/** Resolve offer context for a terminating run id (used at `chat:done`). */
export function resolveRunSummaryOfferFromRunId(
  runId: string,
  conversationId: string,
  workspaceId: string,
  events: TimelineEvent[]
): (RunEditWindow & { conversationId: string; workspaceId: string; durationMs: number }) | null {
  const window = resolveRunEditWindowFromRunId(runId, events);
  if (!window) return null;
  const ctx: RunEditWindow & { conversationId: string; workspaceId: string; durationMs: number } = {
    conversationId,
    workspaceId,
    promptId: window.promptId,
    durationMs: Math.max(0, window.completedAt - window.promptEvent.ts),
    completedAt: window.completedAt,
    editCount: window.editCount,
    fileCount: window.fileCount,
    events
  };
  return shouldOfferRunSummary(ctx) ? ctx : null;
}

export function buildRunSummaryInput(
  ctx: RunEditWindow & { conversationId: string; workspaceId: string; durationMs: number },
  providers: ProviderConfig[] = [],
  conversationFallback: { providerId?: string; modelId?: string } | null = null
): GenerateRunSummaryInput | null {
  const prompt = promptEvent(ctx.events, ctx.promptId);
  if (!prompt) return null;
  const edits = collectRunFileEdits(ctx.events, ctx.promptId, ctx.completedAt);
  if (edits.length === 0) return null;

  let usageAgg;
  for (const e of runWindowEvents(ctx.events, ctx.promptId, ctx.completedAt)) {
    if (e.kind === 'token-usage') {
      usageAgg = foldTokenUsage(usageAgg, e.usage, e.ts, e.assistantMsgId);
    }
  }
  const cumulative = usageAgg?.cumulative;
  const model =
    resolveModelForPrompt(
      ctx.events,
      ctx.promptId,
      conversationFallback?.providerId && conversationFallback?.modelId
        ? {
            providerId: conversationFallback.providerId,
            modelId: conversationFallback.modelId
          }
        : null
    ) ??
    (prompt.providerId && prompt.modelId
      ? { providerId: prompt.providerId, modelId: prompt.modelId }
      : null);
  const costUsd =
    cumulative && model ? estimateRunCostUsd(model, providers, cumulative) : null;

  return {
    conversationId: ctx.conversationId,
    workspaceId: ctx.workspaceId,
    promptId: ctx.promptId,
    promptPreview: clipRunSummaryPromptPreview(prompt.content),
    durationMs: ctx.durationMs,
    completedAt: ctx.completedAt,
    edits,
    ...(cumulative
      ? {
          usageSummary: {
            promptTokens: cumulative.promptTokens,
            completionTokens: cumulative.completionTokens,
            ...(cumulative.cachedPromptTokens !== undefined
              ? { cachedPromptTokens: cumulative.cachedPromptTokens }
              : {}),
            ...(cumulative.cacheCreationTokens !== undefined
              ? { cacheCreationTokens: cumulative.cacheCreationTokens }
              : {}),
            ...(cumulative.reasoningTokens !== undefined
              ? { reasoningTokens: cumulative.reasoningTokens }
              : {})
          }
        }
      : {}),
    ...(costUsd !== null ? { costUsd } : {}),
    ...(model ? { modelLabel: `${model.providerId} / ${model.modelId}` } : {})
  };
}
