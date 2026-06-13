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
    partialToolCallArgs: slice.partialToolCallArgs,
    settledCallIds: slice.settledCallIds,
    liveDiffByCallId: slice.liveDiffByCallId,
    toolResultSettledIds: slice.toolResultSettledIds,
    liveReportResultIds: slice.liveReportResultIds,
    orchestratorUsage: slice.orchestratorUsage,
    lastPromptCacheMissReason: slice.lastPromptCacheMissReason,
    latestOrchestratorRunStatus: slice.latestOrchestratorRunStatus,
    latestContextUsage: slice.latestContextUsage,
    lastUserPromptId: slice.lastUserPromptId,
    lastUserPromptContent: slice.lastUserPromptContent,
    runIdToFileEditCount: slice.runIdToFileEditCount,
    totalRunUsage,
    conversationId: slice.conversationId,
    runId: slice.runId,
    isProcessing: slice.isProcessing,
    awaitingAskUser: slice.awaitingAskUser,
    runStartedAt: slice.runStartedAt,
    draft: slice.draft,
    attachmentDraft: slice.attachmentDraft,
    transcriptPaging: slice.transcriptPaging
  };
}
