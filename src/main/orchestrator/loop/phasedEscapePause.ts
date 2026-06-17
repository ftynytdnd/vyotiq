/**
 * Pause run for phased-execution escape hatch (`ask_user` with structured payload).
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import { cloneLoopCheckpoint, type LoopCheckpoint } from '../pausedRunRegistry.js';
import type { RunStateAccumulator } from './buildRunState.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';
import type { PhaseEngineSnapshot } from '../phased/phaseEngine.js';
import type { GuardTripReason } from '../phased/terminationGuards.js';

export interface PhasedEscapePauseInput {
  runId: string;
  messages: ChatMessage[];
  query: string;
  nextIteration: number;
  consecutiveEmptyTurns: number;
  injectedStubsHighWater: number;
  consecutiveErrors: number;
  consecutiveBadToolRounds: number;
  runStateAcc: RunStateAccumulator;
  spin: SpinSignatureBuffer;
  runCumulativeTokens: number;
  toolCallId: string;
  payload: AskUserStructuredPayload;
  displayText: string;
  phaseEngineSnapshot: PhaseEngineSnapshot;
  trip: GuardTripReason;
  emit: (event: TimelineEvent) => void;
}

export function pauseRunForPhasedEscape(input: PhasedEscapePauseInput): LoopCheckpoint {
  const promptEventId = randomUUID();
  input.emit({
    kind: 'ask-user-prompt',
    id: promptEventId,
    ts: Date.now(),
    displayText: input.displayText,
    payload: input.payload,
    toolCallId: input.toolCallId,
    runId: input.runId,
    status: 'pending',
    source: 'phased-escape'
  });
  input.runStateAcc.lastAction = 'clarify';
  return cloneLoopCheckpoint({
    messages: input.messages,
    query: input.query,
    nextIteration: input.nextIteration,
    consecutiveEmptyTurns: input.consecutiveEmptyTurns,
    injectedStubsHighWater: input.injectedStubsHighWater,
    consecutiveErrors: input.consecutiveErrors,
    consecutiveBadToolRounds: input.consecutiveBadToolRounds,
    runStateAcc: input.runStateAcc,
    spin: input.spin,
    askUserToolCallId: input.toolCallId,
    askUserPromptEventId: promptEventId,
    askUserPayload: input.payload,
    runCumulativeTokens: input.runCumulativeTokens,
    phaseEngineSnapshot: input.phaseEngineSnapshot,
    phasedEscape: true,
    phasedEscapeTrip: input.trip.kind
  });
}
