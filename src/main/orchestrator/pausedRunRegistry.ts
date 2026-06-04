/**
 * In-memory registry for orchestrator runs paused on `ask_user`.
 * Holds loop checkpoint + IPC callbacks until the user submits answers.
 */

import type { ChatMessage, ChatSendInput, TimelineEvent } from '@shared/types/chat.js';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
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
  counters: {
    consecutiveBadRounds: number;
    perTaskBadStreak: Array<[string, number]>;
  };
  spin: SpinSignatureBuffer;
  askUserToolCallId: string;
  askUserPromptEventId: string;
  askUserPayload: AskUserStructuredPayload;
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
  counters: { consecutiveBadRounds: number; perTaskBadStreak: Map<string, number> };
  spin: SpinSignatureBuffer;
  askUserToolCallId: string;
  askUserPromptEventId: string;
  askUserPayload: AskUserStructuredPayload;
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
    counters: {
      consecutiveBadRounds: state.counters.consecutiveBadRounds,
      perTaskBadStreak: [...state.counters.perTaskBadStreak.entries()]
    },
    spin: { window: [...state.spin.window] },
    askUserToolCallId: state.askUserToolCallId,
    askUserPromptEventId: state.askUserPromptEventId,
    askUserPayload: state.askUserPayload
  };
}

export function restoreDelegationCounters(checkpoint: LoopCheckpoint): {
  consecutiveBadRounds: number;
  perTaskBadStreak: Map<string, number>;
} {
  return {
    consecutiveBadRounds: checkpoint.counters.consecutiveBadRounds,
    perTaskBadStreak: new Map(checkpoint.counters.perTaskBadStreak)
  };
}
