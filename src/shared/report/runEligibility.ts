/**
 * Shared run eligibility for HTML report offers and host ask_user gate.
 * Used by main (orchestrator intercept) and renderer (footer / toast).
 */

import type { TimelineEvent } from '../types/chat.js';
import {
  AUTO_REPORT_MIN_EDITS,
  AUTO_REPORT_MIN_FILES
} from './deliverables.js';

export interface RunEditWindow {
  promptId: string;
  completedAt: number;
  events: TimelineEvent[];
  editCount?: number;
  fileCount?: number;
}

function promptEvent(
  events: TimelineEvent[],
  promptId: string
): Extract<TimelineEvent, { kind: 'user-prompt' }> | null {
  const found = events.find((e) => e.kind === 'user-prompt' && e.id === promptId);
  return found?.kind === 'user-prompt' ? found : null;
}

export function runWindowEvents(
  events: TimelineEvent[],
  promptId: string,
  completedAt: number
): TimelineEvent[] {
  const prompt = promptEvent(events, promptId);
  if (!prompt) return [];
  const startTs = prompt.ts;
  const runId = prompt.runId;
  return events.filter((e) => {
    if (e.ts < startTs || e.ts > completedAt + 500) return false;
    if (runId && 'runId' in e && typeof e.runId === 'string' && e.runId !== runId) {
      return false;
    }
    return true;
  });
}

export function runHadReport(events: TimelineEvent[], promptId: string, completedAt: number): boolean {
  return runWindowEvents(events, promptId, completedAt).some(
    (e) =>
      e.kind === 'tool-result' &&
      e.result.ok &&
      e.result.data?.tool === 'report'
  );
}

export function collectRunFileEdits(
  events: TimelineEvent[],
  promptId: string,
  completedAt: number
): Array<{ filePath: string; additions: number; deletions: number }> {
  const byPath = new Map<string, { filePath: string; additions: number; deletions: number }>();
  for (const e of runWindowEvents(events, promptId, completedAt)) {
    if (e.kind !== 'file-edit') continue;
    const prev = byPath.get(e.filePath);
    if (prev) {
      prev.additions += e.additions;
      prev.deletions += e.deletions;
    } else {
      byPath.set(e.filePath, {
        filePath: e.filePath,
        additions: e.additions,
        deletions: e.deletions
      });
    }
  }
  return [...byPath.values()];
}

export function meetsEditReportThresholds(ctx: RunEditWindow): boolean {
  const edits = collectRunFileEdits(ctx.events, ctx.promptId, ctx.completedAt);
  if (edits.length === 0) return false;
  const editCount = ctx.editCount ?? edits.length;
  const fileCount = ctx.fileCount ?? edits.length;
  return editCount >= AUTO_REPORT_MIN_EDITS || fileCount >= AUTO_REPORT_MIN_FILES;
}

/** Footer / toast offer — large edits without an agent report yet. */
export function shouldOfferRunSummary(ctx: RunEditWindow): boolean {
  if (!meetsEditReportThresholds(ctx)) return false;
  return !runHadReport(ctx.events, ctx.promptId, ctx.completedAt);
}

/** Host ask_user gate — same thresholds, no prior report, setting enabled. */
export function shouldPromptForReportAfterEdits(
  ctx: RunEditWindow,
  promptForReportAfterEdits: boolean
): boolean {
  if (!promptForReportAfterEdits) return false;
  return shouldOfferRunSummary(ctx);
}

/** Resolve edit stats for a terminating run id. */
export function resolveRunEditWindowFromRunId(
  runId: string,
  events: TimelineEvent[]
): (RunEditWindow & { promptEvent: Extract<TimelineEvent, { kind: 'user-prompt' }> }) | null {
  const prompts = events.filter(
    (e): e is Extract<TimelineEvent, { kind: 'user-prompt' }> =>
      e.kind === 'user-prompt' && e.runId === runId
  );
  const prompt = prompts[prompts.length - 1];
  if (!prompt) return null;

  const completedAt = events
    .filter((e) => e.ts >= prompt.ts)
    .reduce((max, e) => Math.max(max, e.ts), prompt.ts);
  const windowEvents = runWindowEvents(events, prompt.id, completedAt);
  const fileEditEvents = windowEvents.filter((e) => e.kind === 'file-edit');
  const editCount = fileEditEvents.length;
  const fileCount = new Set(fileEditEvents.map((e) => e.filePath)).size;

  return {
    promptId: prompt.id,
    completedAt,
    events,
    editCount,
    fileCount,
    promptEvent: prompt
  };
}

export function hostReportGateWasShown(events: TimelineEvent[], runId: string): boolean {
  return events.some(
    (e) => e.kind === 'ask-user-prompt' && e.runId === runId && e.source === 'host-report-gate'
  );
}
