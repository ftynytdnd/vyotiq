import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { parseAskUserArgs, resolveAskUserPayload } from '@shared/text/parseAskUser.js';
import { logger } from '../../logging/logger.js';
import { requestUserAttention } from '../../window/requestUserAttention.js';
import { insertHistoryBeforeTail } from '../context/buildContextLayers.js';
import { cloneLoopCheckpoint } from '../pausedRunRegistry.js';
import type { RunStateAccumulator } from './buildRunState.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';

const log = logger.child('askUserPause');

export interface AskUserPauseInput {
  askUserCall: PartialToolCall;
  assistantText: string;
  reasoningText: string;
  iteration: number;
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
  dynamicLoopAuditAwaitingResponse?: boolean;
  emit: (event: TimelineEvent) => void;
  deferred?: boolean;
}

export function pauseRunForAskUser(input: AskUserPauseInput): {
  pausedForAskUser: ReturnType<typeof cloneLoopCheckpoint>;
} {
  const askArgs = parseAskUserArgs(
    tryParseArgumentsRecord(input.askUserCall.argumentsBuf) ?? {}
  );
  const payload = resolveAskUserPayload(askArgs);
  const question =
    askArgs.displayText ||
    input.assistantText.trim() ||
    'Could you clarify how you would like me to proceed?';
  if (!input.askUserCall.id) input.askUserCall.id = randomUUID();
  const promptEventId = randomUUID();

  // Deferred co-emission runs action tools first; the ask_user assistant row
  // was omitted from the initial history insert — mirror hostReportGate pairing.
  if (input.deferred) {
    insertHistoryBeforeTail(input.messages, {
      role: 'assistant',
      content: input.assistantText.trim().length > 0 ? input.assistantText : null,
      ...(input.reasoningText.length > 0 ? { reasoning_content: input.reasoningText } : {}),
      tool_calls: [
        {
          id: input.askUserCall.id,
          type: 'function',
          function: {
            name: 'ask_user',
            arguments: input.askUserCall.argumentsBuf || '{}'
          }
        }
      ]
    });
  }

  input.emit({
    kind: 'ask-user-prompt',
    id: promptEventId,
    ts: Date.now(),
    displayText: question,
    payload,
    toolCallId: input.askUserCall.id,
    runId: input.runId,
    status: 'pending'
  });
  requestUserAttention('ask-user');
  input.runStateAcc.lastAction = 'clarify';
  log.info(
    input.deferred
      ? 'deferred ask_user — pausing after co-emitted tools'
      : 'ask_user tool call — pausing run for interactive user reply',
    {
      iteration: input.iteration,
      questionChars: question.length,
      toolCallId: input.askUserCall.id,
      deferred: Boolean(input.deferred)
    }
  );
  return {
    pausedForAskUser: cloneLoopCheckpoint({
      messages: input.messages,
      query: input.query,
      nextIteration: input.nextIteration,
      consecutiveEmptyTurns: input.consecutiveEmptyTurns,
      injectedStubsHighWater: input.injectedStubsHighWater,
      consecutiveErrors: input.consecutiveErrors,
      consecutiveBadToolRounds: input.consecutiveBadToolRounds,
      runStateAcc: input.runStateAcc,
      spin: input.spin,
      askUserToolCallId: input.askUserCall.id,
      askUserPromptEventId: promptEventId,
      askUserPayload: payload,
      runCumulativeTokens: input.runCumulativeTokens,
      ...(input.dynamicLoopAuditAwaitingResponse !== undefined
        ? { dynamicLoopAuditAwaitingResponse: input.dynamicLoopAuditAwaitingResponse }
        : {})
    })
  };
}
