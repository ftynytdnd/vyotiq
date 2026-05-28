/**
 * Project a per-conversation slice onto the active mirror shape.
 */

import type { ActiveMirror, ChatSlice } from './chatStoreTypes.js';
import { computeTotalRunUsage } from './chatStoreTotalRunUsage.js';

export function mirrorOf(slice: ChatSlice): ActiveMirror {
  const totalRunUsage = computeTotalRunUsage(slice);
  return {
    events: slice.events,
    assistantTexts: slice.assistantTexts,
    reasoningTexts: slice.reasoningTexts,
    subagents: slice.subagents,
    partialToolCallArgs: slice.partialToolCallArgs,
    settledCallIds: slice.settledCallIds,
    liveDiffByCallId: slice.liveDiffByCallId,
    toolResultSettledIds: slice.toolResultSettledIds,
    orchestratorUsage: slice.orchestratorUsage,
    latestOrchestratorRunStatus: slice.latestOrchestratorRunStatus,
    lastDelegationPhaseTs: slice.lastDelegationPhaseTs,
    lastUserPromptId: slice.lastUserPromptId,
    lastUserPromptContent: slice.lastUserPromptContent,
    runIdToFileEditCount: slice.runIdToFileEditCount,
    summaries: slice.summaries,
    messageOverrides: slice.messageOverrides,
    totalRunUsage,
    conversationId: slice.conversationId,
    runId: slice.runId,
    isProcessing: slice.isProcessing,
    runStartedAt: slice.runStartedAt,
    draft: slice.draft
  };
}
