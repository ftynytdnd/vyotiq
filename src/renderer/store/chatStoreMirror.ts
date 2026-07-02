/**
 * Project a per-conversation slice onto the active mirror shape.
 */

import type { ActiveMirror, ChatSlice } from './chatStoreTypes.js';
import { EMPTY_FOLLOW_UP_STATE } from '@shared/types/followUp.js';
import { computeTotalRunUsage } from './chatStoreTotalRunUsage.js';

function normalizeFollowUps(
  followUps: ChatSlice['followUps'] | undefined
): ChatSlice['followUps'] {
  if (!followUps) return { ...EMPTY_FOLLOW_UP_STATE };
  return {
    steering: Array.isArray(followUps.steering) ? followUps.steering : [],
    queued: Array.isArray(followUps.queued) ? followUps.queued : []
  };
}

export function mirrorOf(slice: ChatSlice): ActiveMirror {
  const totalRunUsage = computeTotalRunUsage(slice);
  return {
    events: slice.events ?? [],
    assistantTexts: slice.assistantTexts,
    reasoningTexts: slice.reasoningTexts,
    partialToolCallArgs: slice.partialToolCallArgs,
    settledCallIds: slice.settledCallIds,
    liveDiffByCallId: slice.liveDiffByCallId,
    liveToolOutputByCallId: slice.liveToolOutputByCallId,
    toolResultSettledIds: slice.toolResultSettledIds,
    liveReportResultIds: slice.liveReportResultIds,
    toolCacheHint: slice.toolCacheHint ?? null,
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
    transcriptPaging: slice.transcriptPaging,
    followUps: normalizeFollowUps(slice.followUps)
  };
}
