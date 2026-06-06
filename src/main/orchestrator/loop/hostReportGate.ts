/**
 * Host-injected `ask_user` gate before terminal finish on large edit runs.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import type { ResolvedReportsSettings } from '@shared/report/reportsSettings.js';
import {
  collectRunFileEdits,
  hostReportGateWasShown,
  shouldPromptForReportAfterEdits
} from '@shared/report/runEligibility.js';
import { readTranscript } from '../../conversations/conversationStore.js';
import { cloneLoopCheckpoint, type LoopCheckpoint } from '../pausedRunRegistry.js';
import type { RunStateAccumulator } from './buildRunState.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orch/hostReportGate');

export type PendingTerminalKind = 'finish' | 'implicit-finish';

export interface HostReportGateContext {
  runId: string;
  conversationId: string;
  promptEventId?: string;
  reportsSettings: ResolvedReportsSettings;
  messages: ChatMessage[];
  query: string;
  nextIteration: number;
  consecutiveEmptyTurns: number;
  injectedStubsHighWater: number;
  consecutiveErrors: number;
  consecutiveBadToolRounds: number;
  runStateAcc: RunStateAccumulator;
  spin: SpinSignatureBuffer;
  pendingTerminal: PendingTerminalKind;
  emit: (event: TimelineEvent) => void;
}

export interface HostReportGatePause {
  pausedForAskUser: LoopCheckpoint;
}

const HOST_REPORT_QUESTION_ID = 'host-report-gate';

export function buildHostReportGatePayload(
  fileCount: number,
  editCount: number
): AskUserStructuredPayload {
  return {
    title: 'Generate HTML report?',
    questions: [
      {
        id: HOST_REPORT_QUESTION_ID,
        prompt: `This run edited ${editCount} file${editCount === 1 ? '' : 's'} across ${fileCount} path${fileCount === 1 ? '' : 's'}. Generate an HTML report?`,
        allow_multiple: false,
        options: [
          { id: 'yes', label: 'Yes — generate report' },
          { id: 'no', label: 'No — skip' }
        ]
      }
    ]
  };
}

export const HOST_REPORT_GATE_YES_INSTRUCTION =
  'The user accepted the HTML report offer. Call the `report` tool now with a severity table and ' +
  'PR-style directory groups for every file changed. Post one short timeline paragraph, then call `finish`.';

export function isHostReportGateNoAnswer(
  _payload: AskUserStructuredPayload,
  answers: Array<{ questionId: string; selectedOptionIds?: string[] }>
): boolean {
  const answer = answers.find((a) => a.questionId === HOST_REPORT_QUESTION_ID);
  return answer?.selectedOptionIds?.includes('no') === true;
}

async function resolvePromptEventId(
  conversationId: string,
  runId: string,
  promptEventId?: string
): Promise<string | null> {
  if (promptEventId) return promptEventId;
  const events = await readTranscript(conversationId);
  const prompts = events.filter(
    (e): e is Extract<TimelineEvent, { kind: 'user-prompt' }> =>
      e.kind === 'user-prompt' && e.runId === runId
  );
  return prompts[prompts.length - 1]?.id ?? null;
}

/**
 * Intercept terminal finish when large edits lack a report and settings allow the gate.
 * Returns a pause checkpoint or `null` to proceed with normal termination.
 */
export async function maybeInterceptHostReportGate(
  ctx: HostReportGateContext
): Promise<HostReportGatePause | null> {
  if (!ctx.reportsSettings.promptForReportAfterEdits) return null;
  if (!ctx.conversationId) return null;
  if (ctx.runId.startsWith('manual:')) return null;

  const events = await readTranscript(ctx.conversationId);
  if (hostReportGateWasShown(events, ctx.runId)) return null;

  const promptId = await resolvePromptEventId(ctx.conversationId, ctx.runId, ctx.promptEventId);
  if (!promptId) return null;

  const completedAt = Date.now();
  const edits = collectRunFileEdits(events, promptId, completedAt);
  const fileCount = new Set(edits.map((e) => e.filePath)).size;
  const editCount = edits.length;

  if (
    !shouldPromptForReportAfterEdits(
      { promptId, completedAt, events, editCount, fileCount },
      true
    )
  ) {
    return null;
  }

  const payload = buildHostReportGatePayload(fileCount, editCount);
  const displayText = payload.questions[0]?.prompt ?? 'Generate an HTML report?';
  const toolCallId = randomUUID();
  const promptEventId = randomUUID();

  ctx.messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: 'ask_user', arguments: JSON.stringify({ displayText }) }
      }
    ]
  });

  ctx.emit({
    kind: 'ask-user-prompt',
    id: promptEventId,
    ts: Date.now(),
    displayText,
    payload,
    toolCallId,
    runId: ctx.runId,
    status: 'pending',
    source: 'host-report-gate'
  });

  ctx.runStateAcc.lastAction = 'clarify';
  log.info('host report gate — pausing before terminal finish', {
    runId: ctx.runId,
    editCount,
    fileCount,
    pendingTerminal: ctx.pendingTerminal
  });

  return {
    pausedForAskUser: cloneLoopCheckpoint({
      messages: ctx.messages,
      query: ctx.query,
      nextIteration: ctx.nextIteration,
      consecutiveEmptyTurns: ctx.consecutiveEmptyTurns,
      injectedStubsHighWater: ctx.injectedStubsHighWater,
      consecutiveErrors: ctx.consecutiveErrors,
      consecutiveBadToolRounds: ctx.consecutiveBadToolRounds,
      runStateAcc: ctx.runStateAcc,
      spin: ctx.spin,
      askUserToolCallId: toolCallId,
      askUserPromptEventId: promptEventId,
      askUserPayload: payload,
      hostReportGate: true,
      pendingTerminal: ctx.pendingTerminal,
      reportGateBonusIteration: true
    })
  };
}
