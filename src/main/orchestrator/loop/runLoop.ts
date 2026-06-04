/**
 * The orchestration loop body — a CLOSED, schema-enforced forced-action
 * loop. Every decision turn is sent with `tool_choice: 'required'` (on
 * capable dialects), so "narrate without acting" is structurally
 * impossible and the legacy nudge/heuristic machinery is gone.
 *
 * Per iteration, in order:
 *   1. Refresh the dynamic envelopes (workspace context, recent memory,
 *      meta-rules) and rebuild the system message — this keeps the agent
 *      honest about a moving workspace mid-run.
 *   2. Stream one assistant turn (`handleAssistantTurn`).
 *   3. Dispatch purely on the turn's finished tool calls:
 *        - `finish`    → emit `summary` as the final answer; return.
 *        - `ask_user`  → surface the question, pause cleanly; return.
 *        - `delegate`  → build `ParsedDelegate[]`, run the swarm; continue.
 *        - ls/memory/recall → execute via `handleToolCalls`; continue.
 *      `finish`/`ask_user` are terminal and take precedence. A mixed
 *      continue+delegate turn uses `dispatchMixedTurn` (DAG batches via
 *      `depends_on`; independent tools and delegates run in parallel).
 *   4. No tool calls at all → degradation path (item 6): capable
 *      provider retries once then errors; `ollama-native` accepts
 *      substantive prose as an implicit finish, else one temp-0 retry,
 *      else a visible error.
 *
 * On the iteration cap (`MAX_TOTAL_ITERATIONS`) without a `finish`, one
 * final synthesis turn is issued with `tool_choice: 'none'` and its
 * prose is delivered as the final answer (mirrors the sub-agent wrap-up).
 *
 * On streaming error, retry with exponential backoff up to
 * `MAX_SELF_CORRECTION_ATTEMPTS`; on the third strike, emit `error` and
 * abort the run.
 */

import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatPermissions,
  ChatSendInput,
  TimelineEvent
} from '@shared/types/chat.js';
import type { ProviderDialect } from '@shared/types/provider.js';
import { buildOrchestratorSystemPrompt } from '../../harness/harnessLoader.js';
import { refreshEnvelopes } from '../contextManager.js';
import type { ParsedDelegate } from '../envelope/index.js';
import {
  dispatchMixedTurn,
  type DelegateToolCall
} from './dispatchMixedTurn.js';
import { dedupeDelegateSpecsById, parseDelegateCallMeta } from './delegateToolArgs.js';
import {
  parseStringArgFromBuf,
  tryParseArgumentsRecord
} from './parseToolArgs.js';
import { parseAskUserArgs, resolveAskUserPayload } from '@shared/text/parseAskUser.js';
import { backoff } from '../retry.js';
import { isAbortError } from '../abortSignal.js';
import { logger } from '../../logging/logger.js';
import {
  isNonRecoverableProviderError,
  isProviderError
} from '../../providers/providerError.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { supportsForcedToolChoice } from '../../providers/capabilities.js';
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOTAL_ITERATIONS
} from '@shared/constants.js';
import { ORCHESTRATOR_TOOLS } from '../../tools/policy/index.js';

import { buildSystemPrompt } from './buildSystemPrompt.js';
import { buildOrchestratorRequest } from './buildOrchestratorRequest.js';
import { handleAssistantTurn } from './handleAssistantTurn.js';
import { emitOrchestratorToolValidationFailure } from './emitToolValidationFailure.js';
import type { DelegationCounters } from './handleDelegates.js';
import { DiffStreamer } from '../diffStreamer.js';
import { DiffWorkerPool } from '../diffWorkerPool.js';
import { createStreamingArgsTap } from '../streamingArgsTap.js';
import { lockToolCallIds } from './lockToolCallIds.js';
import {
  messagesSanitizeFingerprint,
  sanitizeToolCallPairingWithStats,
  type SanitizeResult
} from './sanitizeToolPairing.js';
import { emitRunStatus } from './emitRunStatus.js';
import {
  createSpinSignatureBuffer,
  pushToolRound,
  resetSpinBuffer,
  spinHotSignature,
  toolCallSignature,
  type SpinSignatureBuffer
} from './toolSpinSignature.js';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState,
  type RunStateAccumulator
} from './buildRunState.js';
import { buildHostEnvironmentXml } from './buildHostEnvironment.js';
import {
  cloneLoopCheckpoint,
  restoreDelegationCounters,
  type LoopCheckpoint
} from '../pausedRunRegistry.js';


const log = logger.child('orch/runLoop');

/**
 * Minimum length (chars) of plain assistant prose that a NON-FORCED
 * dialect (`ollama-native`, which ignores `tool_choice`) must produce
 * for the host to accept the turn as an IMPLICIT `finish`. Below this
 * the text is treated as an empty/announce-only stall and the loop does
 * one temp-0 retry before surfacing a visible error. Tuned so a real
 * one-sentence answer clears the bar while a bare "Okay." / "Working on
 * it…" does not.
 */
const IMPLICIT_FINISH_MIN_CHARS = 40;

/** Shared shape between the stream's `PartialToolCall` and our local use. */
type FinishedToolCall = {
  id?: string;
  name?: string;
  argumentsBuf: string;
  thoughtSignature?: string;
};

/**
 * Partition finished tool calls into real (non-delegate) tool calls and
 * delegate calls with preserved `tool_call_id` + `depends_on` metadata
 * for the mixed-turn DAG dispatcher.
 */
export function extractDelegateToolCalls(finished: FinishedToolCall[]): {
  realToolCalls: FinishedToolCall[];
  delegateCalls: DelegateToolCall[];
  /** Flattened specs — convenience for logging and query refresh. */
  toolSourcedDelegates: ParsedDelegate[];
  /** Delegate tool calls whose args failed `{ id, task }` validation. */
  invalidDelegateCalls: FinishedToolCall[];
} {
  const real: FinishedToolCall[] = [];
  const delegateCalls: DelegateToolCall[] = [];
  const toolSourcedDelegates: ParsedDelegate[] = [];
  const invalidDelegateCalls: FinishedToolCall[] = [];
  for (const tc of finished) {
    if (tc.name !== 'delegate') {
      real.push(tc);
      continue;
    }
    if (!tc.id) tc.id = randomUUID();
    const { specs, dependsOn } = parseDelegateCallMeta(tc.argumentsBuf || '{}');
    if (specs.length === 0) {
      invalidDelegateCalls.push(tc);
      continue;
    }
    const deduped = dedupeDelegateSpecsById(specs);
    delegateCalls.push({ toolCallId: tc.id, specs: deduped, dependsOn });
    for (const s of deduped) {
      const prev = toolSourcedDelegates.findIndex((d) => d.id === s.id);
      if (prev === -1) toolSourcedDelegates.push(s);
      else toolSourcedDelegates[prev] = s;
    }
  }
  return { realToolCalls: real, delegateCalls, toolSourcedDelegates, invalidDelegateCalls };
}

/**
 * Emit a block of text as the orchestrator's final user-facing answer,
 * rendered identically to a normal streamed assistant turn (a
 * `agent-text-delta` carrying the whole body + its `agent-text-end`
 * marker). Used for `finish.summary` and the iteration-cap synthesis
 * fallback. A fresh `assistantMsgId` keeps it a clean, self-contained
 * row even when the model also streamed prose alongside the tool call.
 */
function emitFinalAnswer(emit: (event: TimelineEvent) => void, text: string): void {
  const id = randomUUID();
  emit({ kind: 'agent-text-delta', id, ts: Date.now(), delta: text });
  emit({ kind: 'agent-text-end', id, ts: Date.now() });
}

interface RunLoopOpts {
  input: ChatSendInput;
  workspacePath: string;
  /** Workspace id (registry id) — required for checkpoint snapshots. */
  workspaceId: string;
  signal: AbortSignal;
  emit: (event: TimelineEvent) => void;
  /** Initial messages array (system + user envelope + replayed history). */
  initialMessages: ChatMessage[];
  /** The rolling-query string used to refresh memory retrieval each iteration.
   *  Defaults to the original user prompt; updated when direct-tool or
   *  sub-agent results land. */
  initialQuery: string;
  permissions: ChatPermissions;
  /** Resume a run paused on `ask_user` — skips re-seeding the user envelope. */
  resumeCheckpoint?: LoopCheckpoint;
}

/** Outcome of a completed orchestrator loop (success, halt, user abort, or ask_user pause). */
interface RunLoopResult {
  /** Set when the loop emitted a terminal `error` timeline row. */
  terminalError?: string;
  /** Set when the run paused on `ask_user` and awaits interactive submit. */
  pausedForAskUser?: LoopCheckpoint;
}

export async function runOrchestratorLoop(opts: RunLoopOpts): Promise<RunLoopResult> {
  const harness = buildOrchestratorSystemPrompt();
  const messages = opts.initialMessages;
  let query = opts.initialQuery;

  const emit = opts.emit;

  let sanitizeFingerprint: string | undefined;
  let sanitizeCached: SanitizeResult | undefined;

  const diffWorkerPool = new DiffWorkerPool();
  const diffStreamer = new DiffStreamer({
    workspacePath: opts.workspacePath,
    runId: opts.input.runId,
    emit: emit,
    computeHunksAsync: (before, after) => diffWorkerPool.computeHunks(before, after)
  });
  const {
    argsDeltaTap,
    onToolCallSettled,
    dispose: disposeArgsTap
  } = createStreamingArgsTap(diffStreamer);
  const disposeStreaming = () => {
    disposeArgsTap();
    diffWorkerPool.dispose();
  };

  // Guarantee disposal on every exit path: abort signal + finally.
  opts.signal.addEventListener('abort', disposeStreaming, { once: true });

  const delegationAbort = new AbortController();
  const delegateSignal = AbortSignal.any([opts.signal, delegationAbort.signal]);

  try {
    const resume = opts.resumeCheckpoint;
    const counters: DelegationCounters = resume
      ? restoreDelegationCounters(resume)
      : {
          consecutiveBadRounds: 0,
          perTaskBadStreak: new Map()
        };
    let consecutiveEmptyTurns = resume?.consecutiveEmptyTurns ?? 0;
    const spin: SpinSignatureBuffer = resume?.spin ?? createSpinSignatureBuffer();
    let injectedStubsHighWater = resume?.injectedStubsHighWater ?? 0;
    let consecutiveErrors = resume?.consecutiveErrors ?? 0;
    let consecutiveBadToolRounds = resume?.consecutiveBadToolRounds ?? 0;
    const runStateAcc: RunStateAccumulator = resume
      ? { ...resume.runStateAcc }
      : createRunStateAccumulator();
    if (resume) {
      query = resume.query;
    }

    let providerName = await resolveProviderName(opts.input.selection.providerId);
    let providerDialect = await resolveProviderDialect(opts.input.selection.providerId);

    for (let iter = resume?.nextIteration ?? 0; iter < MAX_TOTAL_ITERATIONS; iter++) {
      if (opts.signal.aborted) return {};
      const iterStartedAt = Date.now();

        if (iter > 0) {
          try {
            providerName = await resolveProviderName(opts.input.selection.providerId);
            providerDialect = await resolveProviderDialect(opts.input.selection.providerId);
          } catch (err) {
            log.debug('per-iter provider name refresh failed; keeping prior', {
              providerId: opts.input.selection.providerId,
              iter,
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }

        const env = await refreshEnvelopes(
          query,
          opts.input.conversationId,
          opts.workspacePath,
          opts.input.workspaceId
        );
        runStateAcc.iteration = iter;
        runStateAcc.spinSignatureHot = spinHotSignature(spin);
        const runStateXml = buildRunStateXml(
          snapshotRunState(runStateAcc, counters, spin, consecutiveBadToolRounds)
        );
        const hostEnvXml = buildHostEnvironmentXml();
        messages[0] = { role: 'system', content: buildSystemPrompt(harness, env, runStateXml, hostEnvXml) };

        const fp = messagesSanitizeFingerprint(messages);
        const sanitized =
          fp === sanitizeFingerprint && sanitizeCached
            ? sanitizeCached
            : (() => {
              const next = sanitizeToolCallPairingWithStats(messages);
              sanitizeFingerprint = fp;
              sanitizeCached = next;
              return next;
            })();
        const candidateMessages = sanitized.messages;
        if (sanitized.stats.injectedStubs > injectedStubsHighWater) {
          const newCount = sanitized.stats.injectedStubs - injectedStubsHighWater;
          injectedStubsHighWater = sanitized.stats.injectedStubs;
          emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label: `Recovered ${newCount} orphan tool_call(s) from history; the agent will re-issue if needed.`
          });
        }

        const req = buildOrchestratorRequest({
          selection: opts.input.selection,
          messages: candidateMessages,
          signal: opts.signal,
          dialect: providerDialect,
          ...(opts.input.conversationId !== undefined
            ? { conversationId: opts.input.conversationId }
            : {})
        });

        if (iter > 0) {
          emitRunStatus(emit, 'preparing-turn', 'Preparing next turn…', {
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            iteration: iter
          });
        }
        emitRunStatus(
          emit,
          'connecting',
          `Connecting to ${providerName}…`,
          {
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            iteration: iter
          }
        );
        req.onConnect = () => {
          emitRunStatus(
            emit,
            'awaiting-response',
            `Awaiting first token from ${opts.input.selection.modelId}…`,
            {
              providerId: opts.input.selection.providerId,
              modelId: opts.input.selection.modelId,
              iteration: iter
            }
          );
        };

        const turn = await handleAssistantTurn(req, emit, argsDeltaTap);

        if (turn.error) {
          // User-initiated Stop (or the run-scoped signal firing for any
          // other reason) surfaces here as a DOMException('AbortError') from
          // `fetch` / the SSE reader. Prior to this guard, the error
          // branch below treated it as a retriable provider failure,
          // incremented `consecutiveErrors`, and emitted the misleading
          // amber warning "LLM call failed (attempt 1/3): This operation
          // was aborted. Retrying." visible in screenshots §1 / §4. The
          // retry never actually happened (`backoff()` re-aborted and the
          // catch below returned) — but the user-facing row stayed. Detect
          // the abort FIRST, drop any partial text/reasoning accumulator,
          // and exit silently so Stop is a true silent-cancel.
          if (isAbortError(turn.error, opts.signal)) {
            if (turn.hadText || turn.hadReasoning) {
              emit({ kind: 'agent-text-aborted', id: turn.assistantMsgId, ts: Date.now() });
            }
            return {};
          }
          const msg = isProviderError(turn.error)
            ? turn.error.friendlyMessage
            : turn.error instanceof Error
              ? turn.error.message
              : String(turn.error);
          if (isNonRecoverableProviderError(turn.error)) {
            log.warn('LLM call failed (non-recoverable provider error)', {
              kind: turn.error.kind,
              status: turn.error.status,
              msg
            });
            if (turn.hadText || turn.hadReasoning) {
              emit({ kind: 'agent-text-aborted', id: turn.assistantMsgId, ts: Date.now() });
            }
            emit({
              kind: 'error',
              id: randomUUID(),
              ts: Date.now(),
              message: msg
            });
            return { terminalError: msg };
          }
          consecutiveErrors += 1;
          log.warn('LLM call failed', { attempt: consecutiveErrors, msg });
          // One aborted marker drops BOTH the text and reasoning accumulators in
          // the renderer reducer (keyed by assistantMsgId), so we emit it if
          // either stream produced anything. Previously, aborting mid-reasoning
          // without text left the partial reasoning buffer in state until the
          // next turn overwrote it.
          if (turn.hadText || turn.hadReasoning) {
            emit({ kind: 'agent-text-aborted', id: turn.assistantMsgId, ts: Date.now() });
          }
          if (consecutiveErrors >= MAX_SELF_CORRECTION_ATTEMPTS) {
            emit({
              kind: 'error',
              id: randomUUID(),
              ts: Date.now(),
              message: `Provider failed ${consecutiveErrors} times in a row: ${msg}`
            });
            return { terminalError: `Provider failed ${consecutiveErrors} times in a row: ${msg}` };
          }
          emit({
            kind: 'agent-thought',
            id: randomUUID(),
            ts: Date.now(),
            content: `LLM call failed (attempt ${consecutiveErrors}/${MAX_SELF_CORRECTION_ATTEMPTS}): ${msg}. Retrying.`,
            // Mark retry warnings as `warn` so the renderer can paint them
            // in the warning tone instead of mixing them in with the muted
            // "thinking…" indicator. See plan §H.
            severity: 'warn'
          });
          emitRunStatus(
            emit,
            'retrying',
            `Retrying provider call (${consecutiveErrors}/${MAX_SELF_CORRECTION_ATTEMPTS})…`,
            {
              attempt: consecutiveErrors,
              maxAttempts: MAX_SELF_CORRECTION_ATTEMPTS,
              providerId: opts.input.selection.providerId,
              modelId: opts.input.selection.modelId
            }
          );
          try {
            await backoff(consecutiveErrors, { signal: opts.signal });
          } catch {
            return {};
          }
          runStateAcc.lastAction = 'retry';
          continue;
        }
        consecutiveErrors = 0;

        if (turn.hadReasoning && !turn.reasoningEndEmitted) {
          emit({
            kind: 'agent-reasoning-end',
            id: turn.assistantMsgId,
            ts: Date.now(),
            ...(typeof turn.reasoningSignature === 'string' && turn.reasoningSignature.length > 0
              ? { signature: turn.reasoningSignature }
              : {})
          });
        }
        if (turn.hadText) {
          emit({ kind: 'agent-text-end', id: turn.assistantMsgId, ts: Date.now() });
        }

        const finishedToolCalls = turn.partialToolCalls.filter((tc) => tc?.name);
        lockToolCallIds(finishedToolCalls);

        const { realToolCalls, delegateCalls, toolSourcedDelegates, invalidDelegateCalls } =
          extractDelegateToolCalls(finishedToolCalls);
        let finishCall = realToolCalls.find((tc) => tc.name === 'finish');
        const askUserCall = realToolCalls.find((tc) => tc.name === 'ask_user');
        const continueTools = realToolCalls.filter(
          (tc) => tc.name !== 'finish' && tc.name !== 'ask_user'
        );

        // When both terminal pause and stop tools appear, clarification wins.
        if (finishCall && askUserCall) {
          log.warn('finish ignored — ask_user takes precedence in same turn', {
            iteration: iter,
            runId: opts.input.runId
          });
          finishCall = undefined;
        }

        // Per-iteration summary log. Structured so triage can grep one line
        // to see exactly what happened in any iteration.
        log.debug('iteration summary', {
          iteration: iter,
          runId: opts.input.runId,
          conversationId: opts.input.conversationId,
          finishReason: turn.finishReason,
          continueTools: continueTools.length,
          delegateCalls: toolSourcedDelegates.length,
          finish: finishCall !== undefined,
          askUser: askUserCall !== undefined,
          invalidDelegates: invalidDelegateCalls.length,
          textChars: turn.assistantText.length,
          reasoningChars: turn.reasoningText.length,
          ms: Date.now() - iterStartedAt
        });

        if (finishCall) {
          const hasCoEmittedActionable =
            continueTools.length > 0 ||
            toolSourcedDelegates.length > 0 ||
            invalidDelegateCalls.length > 0;
          if (hasCoEmittedActionable) {
            log.warn('finish deferred — running co-emitted actionable tools first', {
              iteration: iter,
              runId: opts.input.runId,
              continueTools: continueTools.length,
              delegateCalls: toolSourcedDelegates.length
            });
          } else {
            const summary =
              parseStringArgFromBuf(finishCall.argumentsBuf, 'summary') ||
              turn.assistantText.trim() ||
              'Done.';
            if (!turn.hadText) {
              emitFinalAnswer(emit, summary);
            }
            runStateAcc.lastAction = 'answer';
            log.info('finish tool call — delivering final answer', {
              iteration: iter,
              summaryChars: summary.length
            });
            return {};
          }
        }

        if (askUserCall) {
          const coEmitted =
            continueTools.length > 0 ||
            toolSourcedDelegates.length > 0 ||
            invalidDelegateCalls.length > 0;
          if (coEmitted) {
            log.warn('ask_user immediate pause — skipping co-emitted actionable tools', {
              iteration: iter,
              runId: opts.input.runId,
              continueTools: continueTools.length,
              delegateCalls: toolSourcedDelegates.length,
              invalidDelegates: invalidDelegateCalls.length
            });
          }
          const askArgs = parseAskUserArgs(
            tryParseArgumentsRecord(askUserCall.argumentsBuf) ?? {}
          );
          const payload = resolveAskUserPayload(askArgs);
          const question =
            askArgs.displayText ||
            turn.assistantText.trim() ||
            'Could you clarify how you would like me to proceed?';
          if (!askUserCall.id) askUserCall.id = randomUUID();
          messages.push({
            role: 'assistant',
            content: turn.assistantText.length > 0 ? turn.assistantText : null,
            ...(turn.reasoningText.length > 0 ? { reasoning_content: turn.reasoningText } : {}),
            tool_calls: [
              {
                id: askUserCall.id,
                type: 'function' as const,
                function: { name: 'ask_user', arguments: askUserCall.argumentsBuf || '{}' }
              }
            ]
          });
          const promptEventId = randomUUID();
          emit({
            kind: 'ask-user-prompt',
            id: promptEventId,
            ts: Date.now(),
            displayText: question,
            payload,
            toolCallId: askUserCall.id,
            runId: opts.input.runId,
            status: 'pending'
          });
          runStateAcc.lastAction = 'clarify';
          log.info('ask_user tool call — pausing run for interactive user reply', {
            iteration: iter,
            questionChars: question.length,
            toolCallId: askUserCall.id
          });
          delegationAbort.abort();
          return {
            pausedForAskUser: cloneLoopCheckpoint({
              messages,
              query,
              nextIteration: iter + 1,
              consecutiveEmptyTurns,
              injectedStubsHighWater,
              consecutiveErrors,
              consecutiveBadToolRounds,
              runStateAcc,
              counters,
              spin,
              askUserToolCallId: askUserCall.id,
              askUserPromptEventId: promptEventId,
              askUserPayload: payload
            })
          };
        }

        const historyToolCalls = [...continueTools, ...invalidDelegateCalls];
        const assistantContent: string | null =
          (historyToolCalls.length > 0 || toolSourcedDelegates.length > 0) &&
          turn.assistantText.length === 0
            ? null
            : turn.assistantText;
        messages.push({
          role: 'assistant',
          content: assistantContent,
          ...(turn.reasoningText.length > 0 ? { reasoning_content: turn.reasoningText } : {}),
          // Phase 8 (2026): persist the Anthropic thinking signature on
          // the assistant turn so the next request echoes the
          // `{type:'thinking', thinking, signature}` block back unchanged.
          ...(typeof turn.reasoningSignature === 'string' && turn.reasoningSignature.length > 0
            ? { reasoning_signature: turn.reasoningSignature }
            : {}),
          ...(historyToolCalls.length > 0
            ? {
              tool_calls: historyToolCalls.map((tc) => ({
                id: tc.id!,
                type: 'function' as const,
                function: {
                  name: tc.name ?? 'unknown',
                  arguments: tc.argumentsBuf || '{}'
                },
                ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
                  ? { thoughtSignature: tc.thoughtSignature }
                  : {})
              }))
            }
            : {})
        });

        for (const tc of invalidDelegateCalls) {
          emitOrchestratorToolValidationFailure(
            tc,
            emit,
            messages,
            'Invalid `delegate` arguments — require `{ id, task }` per worker.',
            'invalid delegate arguments',
            onToolCallSettled
          );
        }

        let didWork = false;

        if (invalidDelegateCalls.length > 0) {
          didWork = true;
          consecutiveEmptyTurns = 0;
          resetSpinBuffer(spin);
          runStateAcc.lastAction = 'direct-tool';
          consecutiveBadToolRounds += 1;
        }

        if (continueTools.length > 0 || delegateCalls.length > 0) {
          const dispatch = await dispatchMixedTurn({
            continueTools,
            delegateCalls,
            messages,
            counters,
            emit,
            toolOpts: {
              workspacePath: opts.workspacePath,
              workspaceId: opts.workspaceId,
              runId: opts.input.runId,
              conversationId: opts.input.conversationId ?? '',
              permissions: opts.permissions,
              signal: opts.signal,
              allowlist: ORCHESTRATOR_TOOLS,
              onToolCallSettled
            },
            delegateOpts: {
              selection: opts.input.selection,
              providerName,
              workspacePath: opts.workspacePath,
              workspaceId: opts.workspaceId,
              runId: opts.input.runId,
              conversationId: opts.input.conversationId ?? '',
              permissions: opts.permissions,
              signal: delegateSignal,
              argsDeltaTap,
              onToolCallSettled,
              delegationBatchId: randomUUID()
            }
          });

          if (dispatch.halt) {
            return {
              terminalError: `${MAX_DELEGATION_BAD_ROUNDS} consecutive sub-agent rounds failed verification — escalating to user.`
            };
          }
          if (opts.signal.aborted) return {};

          if (dispatch.didWork) {
            didWork = true;
            consecutiveEmptyTurns = 0;
            resetSpinBuffer(spin);

            if (dispatch.directToolRounds > 0) {
              runStateAcc.serialSingleDelegateRounds = 0;
              runStateAcc.directToolRoundsTotal += dispatch.directToolRounds;
              runStateAcc.lastAction = 'direct-tool';
              const summary = dispatch.lastDirectToolSummary;
              const directQuery = summarizeDirectToolArgs(continueTools);
              if (directQuery.length > 0) {
                query = clampQuery(`${opts.input.prompt} ${directQuery}`, opts.input.prompt);
              }
              if (summary && summary.attempted > 0 && summary.failed === summary.attempted) {
                consecutiveBadToolRounds += 1;
                if (consecutiveBadToolRounds >= MAX_SELF_CORRECTION_ATTEMPTS) {
                  log.warn('tool-round strike halt — consecutive failed tool rounds', {
                    consecutiveBadToolRounds,
                    iteration: iter
                  });
                  emit({
                    kind: 'error',
                    id: randomUUID(),
                    ts: Date.now(),
                    message:
                      `${MAX_SELF_CORRECTION_ATTEMPTS} consecutive tool rounds failed — escalating to user.`
                  });
                  return {
                    terminalError: `${MAX_SELF_CORRECTION_ATTEMPTS} consecutive tool rounds failed — escalating to user.`
                  };
                }
              } else if (summary && summary.attempted > 0) {
                consecutiveBadToolRounds = 0;
                counters.consecutiveBadRounds = 0;
                if (summary.failed < summary.attempted) {
                  const sigs = continueTools
                    .filter((tc) => tc.name)
                    .map((tc) =>
                      toolCallSignature(tc.name!, tryParseArgumentsRecord(tc.argumentsBuf))
                    );
                  pushToolRound(spin, sigs);
                }
              }
            }

            if (dispatch.delegateRounds > 0) {
              consecutiveBadToolRounds = 0;
              runStateAcc.delegateRoundsTotal += dispatch.delegateRounds;
              runStateAcc.lastAction = 'delegate';
              if (
                toolSourcedDelegates.length === 1 &&
                continueTools.length === 0
              ) {
                runStateAcc.serialSingleDelegateRounds += 1;
              } else {
                runStateAcc.serialSingleDelegateRounds = 0;
              }
              query = clampQuery(
                toolSourcedDelegates.map((d) => d.task).join(' '),
                opts.input.prompt
              );
            }
          }
        }

        if (didWork) continue;

        consecutiveEmptyTurns += 1;
        const capable = supportsForcedToolChoice(providerDialect);
        const proseText = turn.assistantText.trim();
        if (!capable && proseText.length >= IMPLICIT_FINISH_MIN_CHARS) {
          runStateAcc.lastAction = 'answer';
          log.info('ollama implicit finish — substantive prose accepted as answer', {
            iteration: iter,
            textChars: proseText.length
          });
          return {};
        }
        if (consecutiveEmptyTurns < 2) {
          log.warn('assistant turn produced no tool call — retrying once', {
            iteration: iter,
            capable,
            proseChars: proseText.length
          });
          runStateAcc.lastAction = 'retry';
          continue;
        }
        {
          const message = capable
            ? 'The model returned no tool call under a forced tool choice twice in a row — escalating to user.'
            : 'The model produced no actionable tool call or substantive answer after a retry — escalating to user.';
          log.warn('empty-turn halt', { iteration: iter, capable, consecutiveEmptyTurns });
          emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message });
          return { terminalError: message };
        }
    }

    log.warn('iteration cap reached — forcing final synthesis turn', {
      cap: MAX_TOTAL_ITERATIONS,
      runId: opts.input.runId,
      conversationId: opts.input.conversationId
    });
    if (opts.signal.aborted) return {};
    {
      const synthMessages = sanitizeToolCallPairingWithStats(messages).messages;
      const synthReq = buildOrchestratorRequest({
        selection: opts.input.selection,
        messages: synthMessages,
        signal: opts.signal,
        dialect: providerDialect,
        wrapUp: true,
        ...(opts.input.conversationId !== undefined
          ? { conversationId: opts.input.conversationId }
          : {})
      });
      const synthTurn = await handleAssistantTurn(synthReq, emit, argsDeltaTap);
      if (synthTurn.error) {
        if (isAbortError(synthTurn.error, opts.signal)) {
          if (synthTurn.hadText || synthTurn.hadReasoning) {
            emit({ kind: 'agent-text-aborted', id: synthTurn.assistantMsgId, ts: Date.now() });
          }
          return {};
        }
        const msg = isProviderError(synthTurn.error)
          ? synthTurn.error.friendlyMessage
          : synthTurn.error instanceof Error
            ? synthTurn.error.message
            : String(synthTurn.error);
        emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: msg });
        return { terminalError: msg };
      }
      if (synthTurn.hadReasoning && !synthTurn.reasoningEndEmitted) {
        emit({
          kind: 'agent-reasoning-end',
          id: synthTurn.assistantMsgId,
          ts: Date.now(),
          ...(typeof synthTurn.reasoningSignature === 'string' && synthTurn.reasoningSignature.length > 0
            ? { signature: synthTurn.reasoningSignature }
            : {})
        });
      }
      if (synthTurn.hadText) {
        emit({ kind: 'agent-text-end', id: synthTurn.assistantMsgId, ts: Date.now() });
      } else if (synthTurn.assistantText.trim().length === 0) {
        // Synthesis produced no prose (e.g. a non-forced dialect that
        // still tried to call a tool). Deliver a minimal honest notice as
        // the final answer so the run never ends silently.
        emitFinalAnswer(
          emit,
          `Reached the ${MAX_TOTAL_ITERATIONS}-iteration limit without an explicit finish. ` +
          'Stopping here — re-send to continue if more work is needed.'
        );
      }
      return {};
    }
  } finally {
    try {
      disposeStreaming();
    } catch (err) {
      log.debug('disposeStreaming threw during runLoop cleanup', {
        runId: opts.input.runId,
        err: err instanceof Error ? err.message : String(err)
      });
    }
    log.info('orchestrator loop exit', {
      runId: opts.input.runId,
      conversationId: opts.input.conversationId,
      workspaceId: opts.workspaceId
    });
  }
  return {};
}

/**
 * Bound on the rolling memory-retrieval query string. Prevents a long
 * `ls` tree from bloating the keyword-scoring pass that drives
 * `<recent_memory>` retrieval. Picked to comfortably hold the user
 * prompt plus a few rounds of focused exploration signals.
 */
const MAX_QUERY_CHARS = 600;

/**
 * Reserved head budget for the original user prompt (T0-4).
 *
 * The clamp used to keep a single trailing window of `MAX_QUERY_CHARS`,
 * which dropped the user-prompt head whenever the prompt itself was
 * longer than the budget. Memory retrieval then keyed on exploration
 * signal alone and lost the actual goal verb.
 *
 * The fix splits the budget into a stable head reserved for the
 * prompt and a trailing window for the freshest exploration signal.
 * The two slices are recombined with a single space so keyword
 * tokenization treats them as one stream. When the prompt is shorter
 * than the head budget, the trailing window grows to absorb the
 * leftover budget.
 */
const PROMPT_HEAD_BUDGET = 200;

/**
 * Cap a rolling-query string to `MAX_QUERY_CHARS` while preserving the
 * caller-supplied prompt head (T0-4).
 *
 * `originalPrompt` is the user's original prompt — its first
 * `PROMPT_HEAD_BUDGET` chars are reserved at the head of the output so
 * the goal verb is never dropped. The remaining budget is filled from
 * the trailing tail of `s`, which carries the freshest exploration
 * signal. When `s` is already short enough, returns it unchanged.
 *
 * Pure / no-throw — exported via the symbol below for the dedicated
 * unit test.
 */
function clampQuery(s: string, originalPrompt: string): string {
  if (s.length <= MAX_QUERY_CHARS) return s;
  const head = originalPrompt.slice(0, PROMPT_HEAD_BUDGET);
  const tailBudget = MAX_QUERY_CHARS - head.length - 1; // -1 for the joining space
  if (tailBudget <= 0) return head.slice(0, MAX_QUERY_CHARS);
  // Drop the prefix that overlaps with `head` so we don't double-
  // count the prompt body in the tail window.
  const remainder = s.startsWith(originalPrompt)
    ? s.slice(originalPrompt.length)
    : s;
  const tail = remainder.length <= tailBudget
    ? remainder
    : remainder.slice(remainder.length - tailBudget);
  const trimmedTail = tail.trimStart();
  return trimmedTail.length > 0 ? `${head} ${trimmedTail}` : head;
}

/** Test-only export so the head-preservation invariant is pinnable. */
export const __test_clampQuery = clampQuery;

/**
 * Per-call cap on individual string-arg values folded into the
 * direct-tool query summary. Keeps a single huge `path` argument
 * from monopolising the budget.
 */
const MAX_ARG_VALUE_CHARS = 80;

/**
 * Trailing code points the clarify-vs-answer probe should walk past
 * before reading the meaningful terminator. Covers the common ASCII
 * closers (`)`, `]`, `}`, `"`, `'`), the typographic counterparts
 * (`”`, `’`), the CJK closing brackets (`」`, `』`, `）`, `】`), and
 * whitespace. Encoded as a `Set<number>` of code points so the probe
 * stays O(1) per step.
 */
const TRAILING_SKIP_CODEPOINTS = new Set<number>([
  0x20 /* ' ' */, 0x09 /* '\t' */, 0x0a /* '\n' */, 0x0d /* '\r' */,
  0x29 /* ')' */, 0x5d /* ']' */, 0x7d /* '}' */,
  0x22 /* '"' */, 0x27 /* '\'' */,
  0x201d /* '”' right double quote */, 0x2019 /* '’' right single quote */,
  0xff09 /* '）' fullwidth right paren */,
  0xff3d /* '］' fullwidth right square bracket */,
  0xff5d /* '｝' fullwidth right brace */,
  0x300d /* '」' right corner bracket */,
  0x300f /* '』' right white corner bracket */,
  0x3011 /* '】' right black lenticular */
]);

/** Cap on probe iterations so a pathological input cannot stall. */
const MAX_TRAILING_PROBE_STEPS = 8;

/**
 * True when the meaningful trailing code point of `s` is `?` (ASCII)
 * or `？` (fullwidth). Walks backward past whitespace and common
 * closing punctuation (quotation, parens, brackets) so a clarifying
 * question wrapped as `Should I do X?)` or `… X?"` is still
 * classified as a clarification. Pure / no-throw.
 *
 * Exported for direct unit-testing — the run-loop's clarify branch
 * `return`s immediately after setting `runStateAcc.lastAction`, so
 * there is no observable downstream state to assert against. A
 * direct test on the helper covers the same contract without
 * requiring the test to drive a contrived two-iteration scenario.
 * Stable sigil set lives in `TRAILING_SKIP_CODEPOINTS` above.
 */

export function endsWithQuestionMark(s: string): boolean {
  let end = s.length;
  for (let steps = 0; steps < MAX_TRAILING_PROBE_STEPS && end > 0; steps++) {
    // Decode the code point ending at `end`. Handle the surrogate-
    // pair case so non-BMP punctuation (rare but possible) doesn't
    // cause a false miss.
    let cp: number;
    let consumed: number;
    const lo = s.charCodeAt(end - 1);
    if (lo >= 0xdc00 && lo <= 0xdfff && end >= 2) {
      const hi = s.charCodeAt(end - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) {
        cp = ((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
        consumed = 2;
      } else {
        cp = lo;
        consumed = 1;
      }
    } else {
      cp = lo;
      consumed = 1;
    }
    if (cp === 0x3f /* '?' */ || cp === 0xff1f /* '？' fullwidth */) return true;
    if (!TRAILING_SKIP_CODEPOINTS.has(cp)) return false;
    end -= consumed;
  }
  return false;
}

/**
 * Per-tool allowlist of argument fields that contribute meaningful
 * keyword signal to the rolling memory-retrieval query. Centralised
 * here (rather than inferred from "any string-typed arg") because the
 * orchestrator's direct toolset can carry incidental long string args
 * — e.g. `memory.write` would otherwise dump a multi-line `content`
 * body into the query, drowning the actual keyword (`key`) and
 * skewing retrieval scoring on the next iteration.
 *
 * Tools / fields not listed here contribute only their tool name to
 * the summary so retrieval still has a coarse signal of "the model
 * just exercised the memory subsystem" without being polluted by the
 * payload.
 */
const TOOL_QUERY_FIELDS: Record<string, ReadonlyArray<string>> = {
  ls: ['path'],
  memory: ['action', 'key', 'scope'],
  recall: ['action', 'conversationId', 'query']
};

/**
 * Distill a direct-tool round into a short, keyword-friendly string
 * for memory retrieval. Extraction policy:
 *
 *   - Iterate the round's finished calls in order.
 *   - For each call, parse `argumentsBuf` defensively (same fallback
 *     shape `handleToolCalls` uses; never throws).
 *   - Append the tool name, then any string-typed arg values from
 *     the per-tool allowlist (`TOOL_QUERY_FIELDS`). Values longer
 *     than `MAX_ARG_VALUE_CHARS` are clamped. Numeric / boolean /
 *     object args, and any string args NOT on the allowlist, are
 *     skipped.
 *
 * The orchestrator's direct toolset is `ls`/`memory`/`recall`; the
 * allowlist captures `path` (ls), `key`/`action`/`scope` (memory),
 * and `conversationId`/`action`/`query` (recall) — the actual
 * high-signal fields the next iteration's retrieval should key on.
 *
 * Pure / side-effect-free so it can be unit-tested in isolation if a
 * future regression demands it. Never throws.
 */
function summarizeDirectToolArgs(
  calls: ReadonlyArray<{ name?: string; argumentsBuf: string }>
): string {
  const parts: string[] = [];
  for (const c of calls) {
    if (!c.name) continue;
    parts.push(c.name);
    const allowed = TOOL_QUERY_FIELDS[c.name];
    if (!allowed) continue;
    const obj = tryParseArgumentsRecord(c.argumentsBuf);
    for (const field of allowed) {
      const v = obj[field];
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      parts.push(
        trimmed.length > MAX_ARG_VALUE_CHARS
          ? trimmed.slice(0, MAX_ARG_VALUE_CHARS)
          : trimmed
      );
    }
  }
  return parts.join(' ');
}

/**
 * Resolve a provider's display name once at run start. The encrypted
 * provider store is the source of truth; failures (missing record,
 * decryption error) fall back to the raw `providerId` so the user
 * still sees a stable label rather than a blank one. Logged at
 * `warn` so triage can spot a misconfigured selection without the
 * run silently surfacing a UUID.
 */
async function resolveProviderName(providerId: string): Promise<string> {
  try {
    const provider = await getProviderWithKey(providerId);
    if (provider?.name) return provider.name;
  } catch (err) {
    log.warn('failed to resolve provider name; falling back to providerId', {
      providerId,
      err: err instanceof Error ? err.message : String(err)
    });
  }
  return providerId;
}

/**
 * Resolve a provider's wire dialect for the forced-action capability
 * decision. Drives `tool_choice` strategy (`buildOrchestratorRequest`)
 * and the empty-turn degradation branch (`supportsForcedToolChoice`).
 * Returns `undefined` on any failure — `supportsForcedToolChoice`
 * treats `undefined` as the OpenAI-compatible (forced-capable) default,
 * the same fallback the chat client applies for providers persisted
 * before the dialect field existed.
 */
async function resolveProviderDialect(
  providerId: string
): Promise<ProviderDialect | undefined> {
  try {
    const provider = await getProviderWithKey(providerId);
    return provider?.dialect;
  } catch (err) {
    log.debug('failed to resolve provider dialect; treating as forced-capable', {
      providerId,
      err: err instanceof Error ? err.message : String(err)
    });
    return undefined;
  }
}
