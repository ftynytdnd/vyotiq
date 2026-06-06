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
  shouldOfferRunSummary,
  type RunEditWindow
} from '@shared/report/runEligibility.js';

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
  ctx: RunEditWindow & { conversationId: string; workspaceId: string; durationMs: number }
): GenerateRunSummaryInput | null {
  const prompt = promptEvent(ctx.events, ctx.promptId);
  if (!prompt) return null;
  const edits = collectRunFileEdits(ctx.events, ctx.promptId, ctx.completedAt);
  if (edits.length === 0) return null;
  return {
    conversationId: ctx.conversationId,
    workspaceId: ctx.workspaceId,
    promptId: ctx.promptId,
    promptPreview: clipRunSummaryPromptPreview(prompt.content),
    durationMs: ctx.durationMs,
    completedAt: ctx.completedAt,
    edits
  };
}
