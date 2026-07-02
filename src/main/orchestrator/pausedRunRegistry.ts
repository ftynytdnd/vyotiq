/**
 * In-memory registry for orchestrator runs paused on `ask_user`.
 * Holds loop checkpoint + IPC callbacks until the user submits answers.
 */

import type { ChatMessage, ChatSendInput, TimelineEvent } from '@shared/types/chat.js';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import type { ResolvedReportsSettings } from '@shared/report/reportsSettings.js';
import type { ResolvedAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import type { RunStateAccumulator } from './loop/buildRunState.js';
import type { SpinSignatureBuffer } from './loop/toolSpinSignature.js';

export interface LoopCheckpoint {
  messages: ChatMessage[];
  query: string;
  nextIteration: number;
  consecutiveEmptyTurns: number;
  injectedStubsHighWater: number;
  consecutiveErrors: number;
  consecutiveBadToolRounds: number;
  runStateAcc: RunStateAccumulator;
  spin: SpinSignatureBuffer;
  askUserToolCallId: string;
  askUserPromptEventId: string;
  askUserPayload: AskUserStructuredPayload;
  /** Host-injected report gate — No skips LLM resume; Yes resumes with report instruction. */
  hostReportGate?: boolean;
  pendingTerminal?: 'finish' | 'implicit-finish';
  /** Grant +1 iteration allowance on resume from host report gate only. */
  reportGateBonusIteration?: boolean;
  /** Summed provider `usage.totalTokens` across LLM turns in this run. */
  runCumulativeTokens?: number;
  /** Host dynamic-loop audit nudge awaiting agent response. */
  dynamicLoopAuditAwaitingResponse?: boolean;
  /** Verify-before-finish audit injections consumed this run. */
  dynamicAuditInjectionCount?: number;
  /** Substantive edit count at last audit injection (dedupe audits). */
  substantiveEditsAtLastAudit?: number;
  /** Index where the current run's history rows start (after replayed transcript). */
  runHistoryStartIndex?: number;
}

interface PausedRunCallbacks {
  emit: (event: TimelineEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onAwaitingUser?: () => void;
}

export interface PausedRunEntry {
  generation: number;
  input: ChatSendInput;
  workspacePath: string;
  workspaceId: string;
  checkpoint: LoopCheckpoint;
  callbacks: PausedRunCallbacks;
  reportsSettings: ResolvedReportsSettings;
  agentBehaviorSettings: ResolvedAgentBehaviorSettings;
}

const pausedRuns = new Map<string, PausedRunEntry>();

export function storePausedRun(runId: string, entry: PausedRunEntry): void {
  pausedRuns.set(runId, entry);
}

export function takePausedRun(runId: string): PausedRunEntry | undefined {
  const entry = pausedRuns.get(runId);
  if (!entry) return undefined;
  pausedRuns.delete(runId);
  return entry;
}

export function getPausedRun(runId: string): PausedRunEntry | undefined {
  return pausedRuns.get(runId);
}

export function isRunAwaitingUser(runId: string): boolean {
  return pausedRuns.has(runId);
}

export function findPausedRunForConversation(conversationId: string): string | undefined {
  for (const [runId, entry] of pausedRuns) {
    if (entry.input.conversationId === conversationId) return runId;
  }
  return undefined;
}

export function clearPausedRun(runId: string): void {
  pausedRuns.delete(runId);
}

export function cloneLoopCheckpoint(state: {
  messages: ChatMessage[];
  query: string;
  nextIteration: number;
  consecutiveEmptyTurns: number;
  injectedStubsHighWater: number;
  consecutiveErrors: number;
  consecutiveBadToolRounds: number;
  runStateAcc: RunStateAccumulator;
  spin: SpinSignatureBuffer;
  askUserToolCallId: string;
  askUserPromptEventId: string;
  askUserPayload: AskUserStructuredPayload;
  hostReportGate?: boolean;
  pendingTerminal?: 'finish' | 'implicit-finish';
  reportGateBonusIteration?: boolean;
  runCumulativeTokens?: number;
  dynamicLoopAuditAwaitingResponse?: boolean;
  dynamicAuditInjectionCount?: number;
  substantiveEditsAtLastAudit?: number;
  runHistoryStartIndex?: number;
}): LoopCheckpoint {
  return {
    // Defensive shallow copy: the checkpoint must not alias the live
    // loop's `messages` array, so a resume that appends can never
    // retroactively mutate state observed elsewhere.
    messages: [...state.messages],
    query: state.query,
    nextIteration: state.nextIteration,
    consecutiveEmptyTurns: state.consecutiveEmptyTurns,
    injectedStubsHighWater: state.injectedStubsHighWater,
    consecutiveErrors: state.consecutiveErrors,
    consecutiveBadToolRounds: state.consecutiveBadToolRounds,
    runStateAcc: { ...state.runStateAcc },
    spin: { window: [...state.spin.window] },
    askUserToolCallId: state.askUserToolCallId,
    askUserPromptEventId: state.askUserPromptEventId,
    askUserPayload: state.askUserPayload,
    ...(state.hostReportGate !== undefined ? { hostReportGate: state.hostReportGate } : {}),
    ...(state.pendingTerminal !== undefined ? { pendingTerminal: state.pendingTerminal } : {}),
    ...(state.reportGateBonusIteration !== undefined
      ? { reportGateBonusIteration: state.reportGateBonusIteration }
      : {}),
    ...(state.runCumulativeTokens !== undefined
      ? { runCumulativeTokens: state.runCumulativeTokens }
      : {}),
    ...(state.dynamicLoopAuditAwaitingResponse !== undefined
      ? { dynamicLoopAuditAwaitingResponse: state.dynamicLoopAuditAwaitingResponse }
      : {}),
    ...(state.dynamicAuditInjectionCount !== undefined
      ? { dynamicAuditInjectionCount: state.dynamicAuditInjectionCount }
      : {}),
    ...(state.substantiveEditsAtLastAudit !== undefined
      ? { substantiveEditsAtLastAudit: state.substantiveEditsAtLastAudit }
      : {}),
    ...(state.runHistoryStartIndex !== undefined
      ? { runHistoryStartIndex: state.runHistoryStartIndex }
      : {})
  };
}
