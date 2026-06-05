/**
 * The orchestration loop body. Decision turns offer tools with
 * `tool_choice: 'auto'`; substantive prose-only answers end the run
 * without forcing another tool round.
 *
 * Per iteration, in order:
 *   1. Refresh the dynamic envelopes (workspace context, recent memory,
 *      meta-rules) and rebuild the system message — this keeps the agent
 *      honest about a moving workspace mid-run.
 *   2. Stream one assistant turn (`handleAssistantTurn`).
 *   3. Dispatch on finished tool calls:
 *        - `finish` / `ask_user` — terminal (clarification wins if both).
 *        - other tools — `handleToolCalls` with DAG batches via `depends_on`.
 *   4. No tool calls at all → substantive prose ends the run; otherwise
 *      one retry, then a visible error.
 *
 * On the iteration cap (`MAX_TOTAL_ITERATIONS`) without a `finish`, one
 * final synthesis turn is issued with `tool_choice: 'none'` and its
 * prose is delivered as the final answer.
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
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import {
  emitFinishToolSettlement,
  resolveFinishSummary
} from './finishIntercept.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import { parseAskUserArgs, resolveAskUserPayload } from '@shared/text/parseAskUser.js';
import { backoff } from '../retry.js';
import { isAbortError } from '../abortSignal.js';
import { logger } from '../../logging/logger.js';
import {
  isNonRecoverableProviderError,
  isPermanentToolChoiceRejection,
  isProviderError
} from '../../providers/providerError.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import { resolveEffectiveThinkingEffort } from '@shared/providers/thinkingEffort.js';
import type { ModelSelection, ModelThinkingCapabilities, ThinkingEffort } from '@shared/types/provider.js';
import {
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOTAL_ITERATIONS
} from '@shared/constants.js';
import { AGENT_TOOLS } from '../../tools/policy/index.js';
import { handleToolCalls } from './handleToolCalls.js';

import { buildSystemPrompt } from './buildSystemPrompt.js';
import { buildOrchestratorRequest } from './buildOrchestratorRequest.js';
import { handleAssistantTurn } from './handleAssistantTurn.js';
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
import { cloneLoopCheckpoint, type LoopCheckpoint } from '../pausedRunRegistry.js';


const log = logger.child('orch/runLoop');

/**
 * Minimum length (chars) of plain assistant prose for the host to accept
 * a prose-only turn as an IMPLICIT `finish`. Below this, one retry then
 * a visible error. Tuned so a real one-sentence answer clears the bar
 * while a bare "Okay." / "Working on it…" does not.
 */
const IMPLICIT_FINISH_MIN_CHARS = 40;

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
   *  Defaults to the original user prompt; updated when tool results land. */
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

  try {
    const resume = opts.resumeCheckpoint;
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
    let reasoningEffort = await resolveProviderThinking(opts.input.selection);
    let modelThinkingCaps = await resolveModelThinkingCaps(opts.input.selection);
    // Run-scoped: flipped on once after a provider 400 that rejected the
    // `tool_choice` field, so the next request omits it instead of
    // terminating the run. See the error branch below.
    let omitToolChoice = false;

    for (let iter = resume?.nextIteration ?? 0; iter < MAX_TOTAL_ITERATIONS; iter++) {
      if (opts.signal.aborted) return {};
      const iterStartedAt = Date.now();

        if (iter > 0) {
          try {
            providerName = await resolveProviderName(opts.input.selection.providerId);
            providerDialect = await resolveProviderDialect(opts.input.selection.providerId);
            reasoningEffort = await resolveProviderThinking(opts.input.selection);
            modelThinkingCaps = await resolveModelThinkingCaps(opts.input.selection);
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
          snapshotRunState(runStateAcc, spin, consecutiveBadToolRounds)
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
          // Orphan tool_call recovery is silent in the timeline now — the
          // stub injection is a transparent self-heal that needs no
          // user-facing row. Kept as a structured log for triage.
          log.debug('recovered orphan tool_call(s) from history', {
            iteration: iter,
            recovered: newCount
          });
        }

        const req = buildOrchestratorRequest({
          selection: opts.input.selection,
          messages: candidateMessages,
          signal: opts.signal,
          dialect: providerDialect,
          omitToolChoice,
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          ...(modelThinkingCaps !== undefined ? { modelThinkingCaps } : {}),
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
          // Safety net: a provider 400 that rejected `tool_choice`
          // (e.g. an unclassified thinking model). Flip the run-scoped
          // omit flag and retry the SAME iteration — no strike, no lost
          // answer — instead of terminating. Guarded so we only do this
          // once; a second identical 400 falls through to normal
          // handling.
          if (!omitToolChoice && isPermanentToolChoiceRejection(turn.error)) {
            omitToolChoice = true;
            log.warn('provider rejected tool_choice — retrying with the field omitted', {
              iteration: iter,
              status: turn.error.status
            });
            if (turn.hadText || turn.hadReasoning) {
              emit({ kind: 'agent-text-aborted', id: turn.assistantMsgId, ts: Date.now() });
            }
            iter--;
            runStateAcc.lastAction = 'retry';
            continue;
          }
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

        let finishCall: (typeof finishedToolCalls)[number] | undefined;
        let askUserCall: (typeof finishedToolCalls)[number] | undefined;
        const actionTools: typeof finishedToolCalls = [];
        for (const tc of finishedToolCalls) {
          const canonical = normalizeRegisteredToolName(tc.name);
          if (canonical) tc.name = canonical;
          if (canonical === 'finish' && !finishCall) finishCall = tc;
          else if (canonical === 'ask_user' && !askUserCall) askUserCall = tc;
          else actionTools.push(tc);
        }

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
          actionTools: actionTools.length,
          finish: finishCall !== undefined,
          askUser: askUserCall !== undefined,
          textChars: turn.assistantText.length,
          reasoningChars: turn.reasoningText.length,
          ms: Date.now() - iterStartedAt
        });

        if (finishCall) {
          if (actionTools.length > 0) {
            log.warn('finish deferred — running co-emitted tools first', {
              iteration: iter,
              runId: opts.input.runId,
              actionTools: actionTools.length
            });
          } else {
            const summary = resolveFinishSummary(finishCall, turn.assistantText);
            if (!turn.hadText) {
              emitFinalAnswer(emit, summary);
            }
            emitFinishToolSettlement(finishCall, summary, emit);
            runStateAcc.lastAction = 'answer';
            log.info('finish tool call — delivering final answer', {
              iteration: iter,
              summaryChars: summary.length
            });
            return {};
          }
        }

        if (askUserCall) {
          if (actionTools.length > 0) {
            log.warn('ask_user immediate pause — skipping co-emitted tools', {
              iteration: iter,
              runId: opts.input.runId,
              actionTools: actionTools.length
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
              spin,
              askUserToolCallId: askUserCall.id,
              askUserPromptEventId: promptEventId,
              askUserPayload: payload
            })
          };
        }

        const assistantContent: string | null =
          actionTools.length > 0 && turn.assistantText.length === 0 ? null : turn.assistantText;
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
          ...(actionTools.length > 0
            ? {
              tool_calls: actionTools.map((tc) => ({
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

        let didWork = false;

        if (actionTools.length > 0) {
          const summary = await handleToolCalls(actionTools, messages, emit, {
            workspacePath: opts.workspacePath,
            workspaceId: opts.workspaceId,
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            permissions: opts.permissions,
            signal: opts.signal,
            allowlist: AGENT_TOOLS,
            onToolCallSettled
          });
          if (opts.signal.aborted) return {};

          if (actionTools.length > 0) {
            didWork = true;
            consecutiveEmptyTurns = 0;
            resetSpinBuffer(spin);
            runStateAcc.toolRoundsTotal += 1;
            runStateAcc.lastAction = 'tool';
            const directQuery = summarizeDirectToolArgs(actionTools);
            if (directQuery.length > 0) {
              query = clampQuery(`${opts.input.prompt} ${directQuery}`, opts.input.prompt);
            }
            if (summary.attempted > 0 && summary.failed === summary.attempted) {
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
            } else if (summary.attempted > 0) {
              consecutiveBadToolRounds = 0;
              if (summary.failed < summary.attempted) {
                const sigs = actionTools
                  .filter((tc) => tc.name)
                  .map((tc) =>
                    toolCallSignature(tc.name!, tryParseArgumentsRecord(tc.argumentsBuf))
                  );
                pushToolRound(spin, sigs);
              }
            }
          }
        }

        if (finishCall && actionTools.length > 0) {
          const summary = resolveFinishSummary(finishCall, turn.assistantText);
          if (!turn.hadText) {
            emitFinalAnswer(emit, summary);
          }
          emitFinishToolSettlement(finishCall, summary, emit, messages);
          runStateAcc.lastAction = 'answer';
          log.info('deferred finish — delivering final answer after co-emitted tools', {
            iteration: iter,
            summaryChars: summary.length
          });
          return {};
        }

        if (didWork) continue;

        consecutiveEmptyTurns += 1;
        const proseText = turn.assistantText.trim();
        if (proseText.length >= IMPLICIT_FINISH_MIN_CHARS) {
          runStateAcc.lastAction = 'answer';
          log.info('implicit finish — substantive prose accepted as answer', {
            iteration: iter,
            textChars: proseText.length
          });
          return {};
        }
        if (consecutiveEmptyTurns < 2) {
          log.warn('assistant turn produced no tool call — retrying once', {
            iteration: iter,
            proseChars: proseText.length
          });
          runStateAcc.lastAction = 'retry';
          continue;
        }
        {
          const message =
            'The model produced no tool call and no substantive answer after a retry — escalating to user.';
          log.warn('empty-turn halt', { iteration: iter, consecutiveEmptyTurns });
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
        omitToolChoice,
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        ...(modelThinkingCaps !== undefined ? { modelThinkingCaps } : {}),
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
  read: ['path'],
  edit: ['path', 'filePath'],
  bash: ['command'],
  search: ['query', 'mode'],
  delete: ['path', 'filePath'],
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
 * High-signal argument fields per tool for memory retrieval on the next iteration.
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
 * Resolve a provider's wire dialect (parallel tool_calls hint, logging).
 * Returns `undefined` on failure.
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

/**
 * Resolve the orchestrator model's normalized thinking effort from the
 * provider record (`modelThinking[modelId]`, falling back to the legacy
 * `anthropicThinking` flag). Drives both the per-dialect wire mapping
 * and the `tool_choice` omission gate. Returns `undefined` on failure
 * (treated as "provider default" everywhere downstream).
 */
async function resolveModelThinkingCaps(
  selection: ModelSelection
): Promise<ModelThinkingCapabilities | undefined> {
  try {
    const provider = await getProviderWithKey(selection.providerId);
    if (!provider) return undefined;
    return findProviderModel(provider, selection.modelId)?.thinking;
  } catch {
    return undefined;
  }
}

async function resolveProviderThinking(
  selection: ModelSelection
): Promise<ThinkingEffort | undefined> {
  try {
    const provider = await getProviderWithKey(selection.providerId);
    if (!provider) return undefined;
    return resolveEffectiveThinkingEffort(
      provider,
      selection.modelId,
      selection.thinkingEffort
    );
  } catch (err) {
    log.debug('failed to resolve provider thinking effort; using provider default', {
      providerId: selection.providerId,
      err: err instanceof Error ? err.message : String(err)
    });
    return undefined;
  }
}
