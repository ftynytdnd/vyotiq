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
 * On streaming error, retry with exponential backoff up to
 * `MAX_SELF_CORRECTION_ATTEMPTS` per burst. After `MAX_PROVIDER_RECOVERY_ROUNDS`
 * harness recovery cycles, emit `error` and abort the run.
 *
 * Runs continue until `finish`, `ask_user`, a budget halt, billing block,
 * user abort, iteration cap wrap-up, or another explicit terminal path.
 */

import { randomUUID } from 'node:crypto';
import { getProviderAccountSnapshot } from '../../providers/providerAccountStore.js';
import type {
  ChatMessage,
  ChatSendInput,
  TimelineEvent
} from '@shared/types/chat.js';
import type { ProviderDialect } from '@shared/types/provider.js';
import { providerDialectReportsPromptCache } from '@shared/providers/promptCacheMetrics.js';
import { buildOrchestratorSystemPromptForRun } from '../../harness/harnessLoader.js';
import { refreshEnvelopes } from '../contextManager.js';
import { wrapXml } from '../envelope/index.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import {
  emitFinishToolSettlement,
  resolveFinishSummary
} from './finishIntercept.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import { pauseRunForAskUser } from './askUserPause.js';
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
  IMPLICIT_FINISH_MIN_CHARS,
  IMPLICIT_FINISH_MIN_SENTENCE_CHARS,
  MAX_PROVIDER_RECOVERY_ROUNDS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  DEFAULT_MAX_TOTAL_ITERATIONS
} from '@shared/constants.js';
import { AGENT_TOOLS } from '../../tools/policy/index.js';
import { handleToolCalls } from './handleToolCalls.js';

import {
  applyCacheLayers,
  buildContextPressureXml,
  insertHistoryBeforeTail,
  isCacheLayeredTopology
} from '../context/buildContextLayers.js';
import {
  resolveAnthropicClearToolTriggerInputTokens,
  resolveAnthropicServerCompactionTriggerTokens,
  type ContextLevel
} from '@shared/context/contextLevel.js';
import { buildOrchestratorRequest } from './buildOrchestratorRequest.js';
import { handleAssistantTurn } from './handleAssistantTurn.js';
import { DiffStreamer } from '../diffStreamer.js';
import { flushVisionQueue } from '../runVisionQueue.js';
import { getPreparedMediaCache } from '../../attachments/preparedMediaCache.js';
import { resolveInputModalitiesForSelection } from '../buildUserTurnMessage.js';
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
import { setActiveRunContextLevel } from '../conversationHasActiveRun.js';
import {
  consumeSteeringFollowUps,
  tryConsumeQueueBeforeFinish,
  type FollowUpInjectResult,
  type FollowUpLoopCtx
} from '../followUps/followUpLoopHooks.js';
import { injectFollowUp } from '../followUps/injectFollowUp.js';
import {
  clearsDynamicLoopAuditAwaiting,
  countSubstantiveEdits,
  injectDynamicLoopAudit,
  shouldInjectDynamicLoopAudit
} from './dynamicLoopAudit.js';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState,
  type RunStateAccumulator
} from './buildRunState.js';
import { buildHostEnvironmentXml } from './buildHostEnvironment.js';
import type { LoopCheckpoint } from '../pausedRunRegistry.js';
import type { ResolvedReportsSettings } from '@shared/report/reportsSettings.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';
import {
  isRunTokenBudgetExceeded,
  isRunWallClockBudgetExceeded,
  resolveAgentBehaviorSettings,
  resolveMaxTotalIterations,
  type ResolvedAgentBehaviorSettings
} from '@shared/settings/agentBehaviorSettings.js';
import {
  createContextReductionState,
  reduceContextIfNeeded
} from '../context/contextCompaction.js';
import { estimatePromptTokensSync, evaluateContextBudget } from '../context/contextBudget.js';
import {
  clampCalibrationRatio,
  loadContextCalibration,
  rememberContextCalibration
} from '../context/contextCalibration.js';
import { listCatalogueSkillNames } from '../../skills/skillRegistry.js';
import { seedInvokedSkills } from '../../tools/context.tool.js';
import { prefetchInvokedSkills } from '../prefetchInvokedSkills.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { maybeInterceptHostReportGate } from './hostReportGate.js';
import {
  formatProviderRecoveryThought,
  formatProviderStrikeError,
  formatRetryThought,
  formatRunTokenBudgetError,
  formatRunWallClockBudgetError,
  formatToolRecoveryThought,
  TOOL_ESCALATION_STEERING_PROMPT,
  RUN_STOPPED_THOUGHT
} from './runLoopMessages.js';


const log = logger.child('orch/runLoop');

/**
 * Minimum length (chars) of plain assistant prose for the host to accept
 * a prose-only turn as an IMPLICIT `finish`. Below this, shorter prose
 * may still qualify via the question-mark or sentence-end probes.
 */

/**
 * Minimum length for the sentence-end probe — accepts concise direct
 * answers ("My name is Ajay K.") while rejecting bare filler ("Okay.").
 */

/** Cap on the original-task body echoed in the per-turn `<goal_anchor>`. */
const GOAL_ANCHOR_MAX_CHARS = 600;

/** User-facing copy when empty-turn retries are exhausted. */
const USER_EMPTY_TURN_ERROR =
  "The assistant didn't produce a complete answer. Try Retry below, switch models, or lower thinking effort.";

/** When the model prints fenced JSON tool calls instead of native `tool_calls`. */
export const USER_PROSE_TOOL_CALL_ERROR =
  'The model described tool calls in prose instead of invoking them. Switch to a model with native tool calling support, or retry.';

import {
  getRecentBillingBlock,
  setRecentBillingBlock,
  __test_resetRecentBillingBlock
} from './recentBillingBlock.js';

export { __test_resetRecentBillingBlock };

/**
 * Emit a block of text as the orchestrator's final user-facing answer,
 * rendered identically to a normal streamed assistant turn (a
 * `agent-text-delta` carrying the whole body + its `agent-text-end`
 * marker). Used for `finish.summary` and other host-delivered final
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
  /** Resume a run paused on `ask_user` — skips re-seeding the user envelope. */
  resumeCheckpoint?: LoopCheckpoint;
  /** Snapshot of `settings.ui.reports` at run start. */
  reportsSettings?: ResolvedReportsSettings;
  /** Snapshot of `settings.ui.agentBehavior` at run start. */
  agentBehaviorSettings?: ResolvedAgentBehaviorSettings;
  /** Wall-clock anchor for optional per-run duration budget. */
  runStartedAt?: number;
  /** Index where the current run's history rows start (after replayed transcript). */
  runHistoryStartIndex?: number;
}

/** Remove the last prose-only assistant row (empty-turn retry). */
function popProseOnlyAssistant(messages: ChatMessage[]): void {
  const idx = isCacheLayeredTopology(messages) ? messages.length - 3 : messages.length - 1;
  if (idx < 0) return;
  const msg = messages[idx];
  if (msg?.role === 'assistant' && !(msg.tool_calls && msg.tool_calls.length > 0)) {
    messages.splice(idx, 1);
  }
}

/** Outcome of a completed orchestrator loop (success, halt, user abort, or ask_user pause). */
interface RunLoopResult {
  /** Set when the loop emitted a terminal `error` timeline row. */
  terminalError?: string;
  /** Set when the run paused on `ask_user` and awaits interactive submit. */
  pausedForAskUser?: LoopCheckpoint;
  /** Set when the run-scoped signal aborted before a terminal error row. */
  aborted?: boolean;
}

function buildFollowUpLoopCtx(
  opts: RunLoopOpts,
  emit: (event: TimelineEvent) => void,
  messages: ChatMessage[],
  runStateAcc: RunStateAccumulator,
  spin: SpinSignatureBuffer
): FollowUpLoopCtx {
  return {
    runId: opts.input.runId,
    conversationId: opts.input.conversationId ?? '',
    workspacePath: opts.workspacePath,
    workspaceId: opts.workspaceId,
    emit,
    messages,
    signal: opts.signal,
    runStateAcc,
    spin
  };
}

function applyFollowUpResult(
  result: FollowUpInjectResult,
  opts: RunLoopOpts,
  invokedSkills: string[]
): string {
  opts.input.selection = { ...result.selection };
  const skill = result.invokedSkill?.trim();
  if (skill) {
    opts.input.invokedSkill = skill;
    if (!invokedSkills.includes(skill)) {
      invokedSkills.push(skill);
    }
    seedInvokedSkills(opts.signal, [skill]);
  }
  return clampQuery(result.query, opts.input.prompt);
}

async function applyFollowUpAndPrefetch(
  result: FollowUpInjectResult,
  opts: RunLoopOpts,
  invokedSkills: string[],
  emit: (event: TimelineEvent) => void,
  messages: ChatMessage[]
): Promise<string> {
  const skillBefore = new Set(invokedSkills);
  const query = applyFollowUpResult(result, opts, invokedSkills);
  const skill = result.invokedSkill?.trim();
  if (skill && !skillBefore.has(skill) && opts.input.conversationId) {
    await prefetchInvokedSkills({
      invokedSkills: [skill],
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.input.runId,
      conversationId: opts.input.conversationId,
      signal: opts.signal,
      messages,
      emit
    });
  }
  return query;
}

export async function runOrchestratorLoop(opts: RunLoopOpts): Promise<RunLoopResult> {
  const invokedSkills = opts.input.invokedSkill?.trim()
    ? [opts.input.invokedSkill.trim()]
    : [];
  seedInvokedSkills(opts.signal, invokedSkills);
  const agentBehaviorSettings =
    opts.agentBehaviorSettings ?? resolveAgentBehaviorSettings();
  const maxTotalIterations = resolveMaxTotalIterations(agentBehaviorSettings);
  let harness = await buildOrchestratorSystemPromptForRun({
    workspacePath: opts.workspacePath,
    invokedSkills,
    maxTotalIterations
  });
  const messages = opts.initialMessages;
  let query = opts.initialQuery;

  const emit = opts.emit;

  let sanitizeFingerprint: string | undefined;
  let sanitizeCached: SanitizeResult | undefined;

  const diffWorkerPool = new DiffWorkerPool();
  const diffStreamer = new DiffStreamer({
    workspacePath: opts.workspacePath,
    runId: opts.input.runId,
    emit,
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

  // Guarantee disposal on every exit path: abort signal + finally. The
  // listener is removed in `finally` so that pause/resume cycles (which
  // re-invoke this loop with the SAME run signal) do not accumulate stale
  // listeners that retain references to already-disposed worker pools.
  opts.signal.addEventListener('abort', disposeStreaming, { once: true });

  try {
    const resume = opts.resumeCheckpoint;
    let consecutiveEmptyTurns = resume?.consecutiveEmptyTurns ?? 0;
    const spin: SpinSignatureBuffer = resume?.spin ?? createSpinSignatureBuffer();
    let injectedStubsHighWater = resume?.injectedStubsHighWater ?? 0;
    let consecutiveErrors = resume?.consecutiveErrors ?? 0;
    const allowlistRefusalCounts = new Map<string, number>();
    let consecutiveBadToolRounds = resume?.consecutiveBadToolRounds ?? 0;
    let providerRecoveryRounds = 0;
    let runHadLlmProgress = false;
    let lastToolRoundFailure: string | undefined;
    let rootToolRoundFailure: string | undefined;
    let runCumulativeTokens = resume?.runCumulativeTokens ?? 0;
    const iterationCapBonus = resume?.reportGateBonusIteration ? 1 : 0;
    const runStateAcc: RunStateAccumulator = resume
      ? { ...createRunStateAccumulator(), ...resume.runStateAcc }
      : createRunStateAccumulator();
    if (resume) {
      query = resume.query;
    }

    let providerName = await resolveProviderName(opts.input.selection.providerId);
    let providerEndpointHost = await resolveProviderEndpointHost(opts.input.selection.providerId);
    let providerDialect = await resolveProviderDialect(opts.input.selection.providerId);
    let reasoningEffort = await resolveProviderThinking(opts.input.selection);
    let modelThinkingCaps = await resolveModelThinkingCaps(opts.input.selection);
    // Run-scoped: flipped on once after a provider 400 that rejected the
    // `tool_choice` field, so the next request omits it instead of
    // terminating the run. See the error branch below.
    let omitToolChoice = false;
    /** Reused on empty-turn retry so the timeline shows one assistant row. */
    let retryAssistantMsgId: string | null = null;
    /** Reasoning-only turns without prose count as progress (capped). */
    let consecutiveReasoningOnlyTurns = 0;
    /** Skip back-to-back host audit nudges until the agent edits/continues. */
    let dynamicLoopAuditAwaitingResponse = resume?.dynamicLoopAuditAwaitingResponse ?? false;
    let dynamicAuditInjectionCount = resume?.dynamicAuditInjectionCount ?? 0;
    let substantiveEditsAtLastAudit = resume?.substantiveEditsAtLastAudit ?? 0;
    const runHistoryStartIndex =
      resume?.runHistoryStartIndex ?? opts.runHistoryStartIndex ?? 0;
    /** Anthropic cache-diagnostics: prior turn `msg_…` id for prefix comparison. */
    let lastAnthropicMessageId: string | undefined;

    const billingBlock = getRecentBillingBlock(opts.input.selection);
    if (billingBlock) {
      emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: billingBlock.message });
      return { terminalError: billingBlock.message };
    }

    const accountPreflight = getProviderAccountSnapshot(opts.input.selection.providerId);
    if (accountPreflight?.balanceAvailable === false) {
      log.warn('provider balance low — continuing (warn-only)', {
        providerId: opts.input.selection.providerId
      });
    }

    const reportsSettings = opts.reportsSettings ?? resolveReportsSettings();
    const reductionState = createContextReductionState();
    let contextSkillNames = await listCatalogueSkillNames(opts.workspacePath, invokedSkills);
    let budgetToolSchemas = toolSchemasFor(AGENT_TOOLS, { contextSkillNames });
    // Calibration: provider-reported prompt tokens ÷ our estimate, carried turn
    // to turn so the budget/meter anchor to what the provider actually bills.
    let calibrationRatio: number | undefined;
    if (opts.input.conversationId) {
      calibrationRatio = await loadContextCalibration(
        opts.input.conversationId,
        opts.input.selection.providerId,
        opts.input.selection.modelId
      );
    }
    // Post-reduction usage level from the previous iteration drives the
    // proactive `<context_pressure>` note on the next turn (one-turn lag is
    // fine: it reflects the lean prompt the model just saw).
    let lastUsageLevel: ContextLevel = 'ok';
    // Raw (uncalibrated) estimate of the exact array sent this turn — the
    // calibration denominator once the provider returns real prompt tokens.
    let rawEstimateThisTurn = 0;
    // Goal anchor — restate the original task near the tail every turn so it
    // survives reversible reduction / summarization (counters lost-in-middle).
    const goalAnchorBody = opts.input.prompt.trim().slice(0, GOAL_ANCHOR_MAX_CHARS);
    const goalAnchorXml =
      goalAnchorBody.length > 0
        ? wrapXml('goal_anchor', `Original task (stay aligned to this): ${goalAnchorBody}`)
        : '';
    let hostReportGatePendingTerminal = resume?.hostReportGate
      ? resume.pendingTerminal
      : undefined;
    const runStartedAtMs = opts.runStartedAt ?? Date.now();
    let consecutiveSpinHotIterations = 0;
    let spinHotNudgeEmitted = false;

    for (let iter = resume?.nextIteration ?? 0; ; iter++) {
      const abortedEarly = exitIfAborted(opts, emit, runHadLlmProgress);
      if (abortedEarly) return abortedEarly;
      if (iter > maxTotalIterations + iterationCapBonus) {
        const capMsg = `Run stopped after ${maxTotalIterations + iterationCapBonus} iterations without a final answer.`;
        emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: capMsg });
        return { terminalError: capMsg };
      }
      const wrapUp = iter === maxTotalIterations + iterationCapBonus;
      if (
        isRunWallClockBudgetExceeded(Date.now() - runStartedAtMs, agentBehaviorSettings)
      ) {
        const wallClockMsg = formatRunWallClockBudgetError(agentBehaviorSettings);
        emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: wallClockMsg });
        return { terminalError: wallClockMsg };
      }

      const iterStartedAt = Date.now();

        if (iter > 0) {
          try {
            providerName = await resolveProviderName(opts.input.selection.providerId);
            providerEndpointHost = await resolveProviderEndpointHost(
              opts.input.selection.providerId
            );
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
        if (runStateAcc.spinSignatureHot) {
          consecutiveSpinHotIterations += 1;
          emitRunStatus(emit, 'nudging', 'Repeating tool pattern — pivot approach…', {
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            iteration: iter
          });
          if (consecutiveSpinHotIterations >= 2 && !spinHotNudgeEmitted) {
            spinHotNudgeEmitted = true;
            emit({
              kind: 'agent-thought',
              id: randomUUID(),
              ts: Date.now(),
              content:
                'The same tool pattern has repeated several times. Pivot to `edit`, `ask_user`, or a different file — do not re-read the same paths.',
              severity: 'warn'
            });
          }
        } else {
          consecutiveSpinHotIterations = 0;
          spinHotNudgeEmitted = false;
        }
        const runStateXml = buildRunStateXml(
          snapshotRunState(runStateAcc, spin, consecutiveBadToolRounds, maxTotalIterations)
        );
        const hostEnvXml = buildHostEnvironmentXml(undefined, {
          workspacePath: opts.workspacePath
        });
        let pressureLevel = lastUsageLevel;
        if (agentBehaviorSettings.contextManagement.enabled) {
          try {
            const pressureUsage = await evaluateContextBudget({
              messages,
              modelId: opts.input.selection.modelId,
              providerId: opts.input.selection.providerId,
              settings: agentBehaviorSettings.contextManagement,
              tools: budgetToolSchemas,
              ...(calibrationRatio !== undefined ? { calibrationRatio } : {}),
              skipRemoteRefine: true
            });
            pressureLevel = pressureUsage.level;
          } catch (err) {
            log.debug('context pressure pre-eval failed; using prior level', {
              iteration: iter,
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }
        const contextPressureXml = agentBehaviorSettings.contextManagement.enabled
          ? buildContextPressureXml(pressureLevel)
          : '';
        harness = await buildOrchestratorSystemPromptForRun({
          workspacePath: opts.workspacePath,
          invokedSkills,
          maxTotalIterations
        });
        contextSkillNames = await listCatalogueSkillNames(opts.workspacePath, invokedSkills);
        budgetToolSchemas = toolSchemasFor(AGENT_TOOLS, { contextSkillNames });
        applyCacheLayers(messages, {
          harness,
          env,
          runStateXml,
          hostEnvironmentXml: hostEnvXml,
          ...(goalAnchorXml.length > 0 ? { goalAnchorXml } : {}),
          ...(contextPressureXml.length > 0 ? { contextPressureXml } : {})
        });
        // Defensive: context reduction is always-on, so a failure here (e.g.
        // a transient provider-store read) must never abort the run — fall
        // back to the unreduced messages and let the provider's own limit /
        // self-correction path handle any overflow.
        // Single budget evaluation per iteration: the reduction pass evaluates
        // usage, (optionally) reduces, and returns the POST-reduction usage —
        // which we reuse for the composer meter telemetry + the Anthropic
        // backstop window (no duplicate tokenize/provider lookup).
        let advertisedWindowForTurn = 0;
        try {
          const reduction = await reduceContextIfNeeded(
            messages,
            {
              ...(opts.input.conversationId !== undefined
                ? { conversationId: opts.input.conversationId }
                : {}),
              runId: opts.input.runId,
              workspacePath: opts.workspacePath,
              modelId: opts.input.selection.modelId,
              providerId: opts.input.selection.providerId,
              settings: agentBehaviorSettings.contextManagement,
              tools: budgetToolSchemas,
              signal: opts.signal,
              ...(calibrationRatio !== undefined ? { calibrationRatio } : {}),
              emit
            },
            reductionState
          );
          messages.length = 0;
          messages.push(...reduction.messages);

          const usage = reduction.usage;
          advertisedWindowForTurn = usage.advertisedWindow;
          lastUsageLevel = usage.level;
          if (opts.input.conversationId) {
            setActiveRunContextLevel(opts.input.conversationId, usage.level);
          }
          emit({
            kind: 'context-usage',
            id: randomUUID(),
            ts: Date.now(),
            usedTokens: usage.usedTokens,
            effectiveWindow: usage.effectiveWindow,
            advertisedWindow: usage.advertisedWindow,
            level: usage.level,
            exact: usage.exact,
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            ...(calibrationRatio !== undefined ? { calibrationRatio } : {}),
            ...(usage.breakdown ? { breakdown: usage.breakdown } : {}),
            ...(usage.visionTokens != null && usage.visionTokens > 0
              ? { visionTokens: usage.visionTokens }
              : {})
          });
        } catch (err) {
          // Defensive: context reduction is always-on, so a failure here (e.g.
          // a transient provider-store read) must never abort the run — fall
          // back to the unreduced messages and let the provider's own limit /
          // self-correction path handle any overflow.
          log.warn('context reduction failed; continuing with full context', {
            runId: opts.input.runId,
            err: err instanceof Error ? err.message : String(err)
          });
        }

        // Opportunistic Anthropic native context-editing backstop: only when
        // host context management is on, the dialect is Anthropic, and we know
        // the window. Trigger sits ABOVE the host trigger so it only fires if
        // host-side reduction somehow fell behind (defense in depth).
        const cmSettings = agentBehaviorSettings.contextManagement;
        const compactionThresholds = {
          warnFraction: cmSettings.warnFraction,
          triggerFraction: cmSettings.triggerFraction
        };
        const anthropicContextEditing =
          cmSettings.enabled &&
          providerDialect === 'anthropic-native' &&
          advertisedWindowForTurn > 0
            ? {
              keepToolUses: cmSettings.keepLastToolResults,
              triggerInputTokens: resolveAnthropicClearToolTriggerInputTokens(
                advertisedWindowForTurn,
                compactionThresholds
              ),
              // Free a worthwhile chunk per server pass + clear stale tool
              // inputs (mirrors the host-side `clear_tool_inputs` tier).
              clearAtLeastTokens: 8_192,
              clearToolInputs: true,
              // Loaded skills are reference material — keep them server-side
              // when Anthropic context editing clears stale tool results.
              excludeTools: ['context'],
              // Opt-in server-side compaction backstop. Trigger sits below the
              // host `clear_tool_uses` band so summarization only fires if
              // clearing alone cannot keep the prompt lean.
              ...(cmSettings.serverSideCompaction
                ? {
                  serverCompaction: {
                    triggerTokens: resolveAnthropicServerCompactionTriggerTokens(
                      advertisedWindowForTurn,
                      compactionThresholds
                    )
                  }
                }
                : {})
            }
            : undefined;

        const visionMsg = await flushVisionQueue({
          runId: opts.input.runId,
          workspacePath: opts.workspacePath,
          selection: opts.input.selection,
          inputModalities: await resolveInputModalitiesForSelection(opts.input.selection),
          mediaCache: getPreparedMediaCache(opts.input.runId),
          signal: opts.signal
        });
        if (visionMsg) insertHistoryBeforeTail(messages, visionMsg);

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
        // Raw (uncalibrated) estimate of the EXACT array we are about to send —
        // the denominator for calibration once the provider returns real
        // prompt tokens for this turn.
        rawEstimateThisTurn = estimatePromptTokensSync(
          opts.input.selection.modelId,
          candidateMessages,
          budgetToolSchemas
        ).tokens;
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
          ...(wrapUp ? { wrapUp: true } : {}),
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          ...(modelThinkingCaps !== undefined ? { modelThinkingCaps } : {}),
          ...(opts.input.conversationId !== undefined
            ? { conversationId: opts.input.conversationId }
            : {}),
          ...(opts.input.workspaceId !== undefined
            ? { workspaceId: opts.input.workspaceId }
            : {}),
          ...(contextSkillNames.length > 0 ? { contextSkillNames } : {}),
          ...(providerDialect === 'anthropic-native'
            ? { previousAnthropicMessageId: lastAnthropicMessageId ?? null }
            : {}),
          ...(anthropicContextEditing !== undefined ? { anthropicContextEditing } : {})
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
          formatConnectingLabel(providerName, providerEndpointHost),
          {
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            iteration: iter,
            ...(providerEndpointHost ? { endpointHost: providerEndpointHost } : {})
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

        const turn = await handleAssistantTurn(req, emit, argsDeltaTap, {
          ...(retryAssistantMsgId ? { assistantMsgId: retryAssistantMsgId } : {}),
          workspacePath: opts.workspacePath,
          runId: opts.input.runId
        });

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
              runHadLlmProgress = true;
            }
            const aborted = exitIfAborted(opts, emit, runHadLlmProgress);
            if (aborted) return aborted;
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
            if (turn.error.kind === 'billing') {
              setRecentBillingBlock(opts.input.selection, msg);
            }
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
            providerRecoveryRounds += 1;
            if (providerRecoveryRounds > MAX_PROVIDER_RECOVERY_ROUNDS) {
              const strikeMsg = formatProviderStrikeError(consecutiveErrors, msg);
              log.warn('provider sustained failures — terminating run', {
                consecutiveErrors,
                providerRecoveryRounds,
                detail: msg
              });
              emit({
                kind: 'error',
                id: randomUUID(),
                ts: Date.now(),
                message: strikeMsg
              });
              return { terminalError: strikeMsg };
            }
            log.warn('provider sustained failures — harness recovery', {
              consecutiveErrors,
              providerRecoveryRounds,
              detail: msg
            });
            emit({
              kind: 'agent-thought',
              id: randomUUID(),
              ts: Date.now(),
              content: formatProviderRecoveryThought(consecutiveErrors, msg),
              severity: 'warn'
            });
            consecutiveErrors = 0;
          }
          const retryContent = formatRetryThought(msg, consecutiveErrors);
          emit({
            kind: 'agent-thought',
            id: randomUUID(),
            ts: Date.now(),
            content: retryContent,
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
            const aborted = exitIfAborted(opts, emit, runHadLlmProgress);
            if (aborted) return aborted;
            return {};
          }
          runStateAcc.lastAction = 'retry';
          continue;
        }
        consecutiveErrors = 0;
        runHadLlmProgress = true;

        // Calibrate future estimates to what the provider actually billed for
        // THIS prompt. `promptTokens` is the exact input size; dividing by our
        // raw estimate yields a multiplicative correction (clamped) that
        // anchors the heuristic to the provider's real tokenizer.
        if (
          turn.usage &&
          turn.usage.promptTokens > 0 &&
          rawEstimateThisTurn > 0
        ) {
          const ratio = turn.usage.promptTokens / rawEstimateThisTurn;
          calibrationRatio = clampCalibrationRatio(ratio);
          if (opts.input.conversationId) {
            void rememberContextCalibration(
              opts.input.conversationId,
              opts.input.selection.providerId,
              opts.input.selection.modelId,
              calibrationRatio
            ).catch((err) => {
              log.debug('failed to persist context calibration', {
                conversationId: opts.input.conversationId,
                err: err instanceof Error ? err.message : String(err)
              });
            });
          }
        }

        if (turn.usage) {
          runCumulativeTokens += turn.usage.totalTokens;
          if (isRunTokenBudgetExceeded(runCumulativeTokens, agentBehaviorSettings)) {
            const budgetMsg = formatRunTokenBudgetError(
              runCumulativeTokens,
              agentBehaviorSettings.runTokenBudget.maxTotalTokens
            );
            log.warn('run token budget exceeded', {
              runId: opts.input.runId,
              cumulativeTotal: runCumulativeTokens,
              maxTotalTokens: agentBehaviorSettings.runTokenBudget.maxTotalTokens
            });
            emit({
              kind: 'error',
              id: randomUUID(),
              ts: Date.now(),
              message: budgetMsg
            });
            return { terminalError: budgetMsg };
          }
        }

        if (turn.anthropicMessageId) {
          lastAnthropicMessageId = turn.anthropicMessageId;
        }
        if (
          turn.anthropicCacheMissReason !== undefined &&
          turn.anthropicCacheMissReason !== null
        ) {
          log.warn('anthropic prompt cache prefix diverged', {
            iteration: iter,
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            cacheMissReason: turn.anthropicCacheMissReason
          });
        }
        if (
          iter > 0 &&
          providerDialect !== undefined &&
          providerDialectReportsPromptCache(providerDialect) &&
          turn.usage &&
          (turn.usage.cachedPromptTokens ?? 0) === 0 &&
          turn.usage.promptTokens >= 1024
        ) {
          const cachePayload = {
            iteration: iter,
            providerId: opts.input.selection.providerId,
            modelId: opts.input.selection.modelId,
            promptTokens: turn.usage.promptTokens,
            ...(turn.anthropicCacheMissReason !== undefined
              ? { cacheMissReason: turn.anthropicCacheMissReason }
              : {})
          };
          // OpenAI-compat / automatic prefix caches (OpenRouter, DeepSeek)
          // often miss on multi-turn growth — expected, not actionable.
          if (
            providerDialect === 'openai' &&
            turn.anthropicCacheMissReason === undefined
          ) {
            log.debug('prompt cache read near zero (automatic prefix cache)', cachePayload);
          } else {
            log.warn('prompt cache read near zero on multi-turn iteration', cachePayload);
          }
        }

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

        const finishedToolCalls = turn.partialToolCalls.filter((tc) => tc);
        lockToolCallIds(finishedToolCalls);

        let finishCall: (typeof finishedToolCalls)[number] | undefined;
        let askUserCall: (typeof finishedToolCalls)[number] | undefined;
        const actionTools: typeof finishedToolCalls = [];
        for (const tc of finishedToolCalls) {
          if (!tc.name) {
            actionTools.push(tc);
            continue;
          }
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

        const assistantContent: string | null =
          actionTools.length > 0 && turn.assistantText.length === 0 ? null : turn.assistantText;
        const askUserOnly = Boolean(askUserCall) && actionTools.length === 0;
        if (askUserCall && askUserOnly && !askUserCall.id) askUserCall.id = randomUUID();
        const toolCallsForHistory = [
          ...actionTools.map((tc) => ({
            id: tc.id!,
            type: 'function' as const,
            function: {
              name: tc.name ?? 'unknown',
              arguments: tc.argumentsBuf || '{}'
            },
            ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
              ? { thoughtSignature: tc.thoughtSignature }
              : {})
          })),
          ...(askUserOnly && askUserCall
            ? [
                {
                  id: askUserCall.id!,
                  type: 'function' as const,
                  function: {
                    name: 'ask_user',
                    arguments: askUserCall.argumentsBuf || '{}'
                  }
                }
              ]
            : [])
        ];
        insertHistoryBeforeTail(messages, {
          role: 'assistant',
          content: assistantContent,
          ...(turn.reasoningText.length > 0 ? { reasoning_content: turn.reasoningText } : {}),
          ...(typeof turn.reasoningSignature === 'string' && turn.reasoningSignature.length > 0
            ? { reasoning_signature: turn.reasoningSignature }
            : {}),
          ...(toolCallsForHistory.length > 0 ? { tool_calls: toolCallsForHistory } : {})
        });

        const followUpCtx = buildFollowUpLoopCtx(opts, emit, messages, runStateAcc, spin);
        if (actionTools.length === 0) {
          const steered = await consumeSteeringFollowUps(followUpCtx);
          if (steered) {
            query = await applyFollowUpAndPrefetch(steered, opts, invokedSkills, emit, messages);
            consecutiveEmptyTurns = 0;
            runStateAcc.lastAction = 'none';
            continue;
          }
        }

        if (finishCall) {
          if (actionTools.length > 0) {
            log.warn('finish deferred — running co-emitted tools first', {
              iteration: iter,
              runId: opts.input.runId,
              actionTools: actionTools.length
            });
          } else {
            if (
              shouldInjectDynamicLoopAudit(
                [],
                finishedToolCalls,
                dynamicLoopAuditAwaitingResponse,
                messages,
                runHistoryStartIndex,
                dynamicAuditInjectionCount,
                substantiveEditsAtLastAudit
              ) &&
              opts.input.conversationId
            ) {
              const auditedBeforeFinishOnly = await injectDynamicLoopAudit(
                followUpCtx,
                opts.input.selection,
                messages,
                runHistoryStartIndex
              );
              if (auditedBeforeFinishOnly) {
                query = await applyFollowUpAndPrefetch(auditedBeforeFinishOnly, opts, invokedSkills, emit, messages);
                consecutiveEmptyTurns = 0;
                runStateAcc.lastAction = 'none';
                dynamicLoopAuditAwaitingResponse = true;
                dynamicAuditInjectionCount += 1;
                substantiveEditsAtLastAudit = countSubstantiveEdits(messages, runHistoryStartIndex);
                log.info('dynamic loop auto-audit injected before finish-only turn', {
                  iteration: iter,
                  runId: opts.input.runId
                });
                continue;
              }
            }
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
            const queued = await tryConsumeQueueBeforeFinish(followUpCtx);
            if (queued) {
              query = await applyFollowUpAndPrefetch(queued, opts, invokedSkills, emit, messages);
              consecutiveEmptyTurns = 0;
              runStateAcc.lastAction = 'none';
              continue;
            }
            const gate = await maybeInterceptHostReportGate({
              runId: opts.input.runId,
              conversationId: opts.input.conversationId ?? '',
              promptEventId: opts.input.promptEventId,
              reportsSettings,
              messages,
              query,
              nextIteration: iter + 1,
              consecutiveEmptyTurns,
              injectedStubsHighWater,
              consecutiveErrors,
              consecutiveBadToolRounds,
              runStateAcc,
              spin,
              pendingTerminal: 'finish',
              emit,
              runCumulativeTokens,
              runHistoryStartIndex
            });
            if (gate) return gate;
            return {};
          }
        }

        if (askUserCall && actionTools.length === 0) {
          return pauseRunForAskUser({
            askUserCall,
            assistantText: turn.assistantText,
            reasoningText: turn.reasoningText,
            iteration: iter,
            runId: opts.input.runId,
            messages,
            query,
            nextIteration: iter + 1,
            consecutiveEmptyTurns,
            injectedStubsHighWater,
            consecutiveErrors,
            consecutiveBadToolRounds,
            runStateAcc,
            spin,
            runCumulativeTokens,
            dynamicLoopAuditAwaitingResponse,
            runHistoryStartIndex,
            emit
          });
        }

        if (askUserCall && actionTools.length > 0) {
          log.warn('ask_user deferred — running co-emitted tools first', {
            iteration: iter,
            runId: opts.input.runId,
            actionTools: actionTools.length
          });
        }

        let didWork = false;

        if (actionTools.length > 0) {
          const spinHotNow = spinHotSignature(spin);
          const summary = await handleToolCalls(actionTools, messages, emit, {
            workspacePath: opts.workspacePath,
            workspaceId: opts.workspaceId,
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            signal: opts.signal,
            allowlist: AGENT_TOOLS,
            allowlistRefusalCounts,
            onToolCallSettled,
            spinSignatureHot: spinHotNow
          });
          const abortedAfterTools = exitIfAborted(opts, emit, runHadLlmProgress);
          if (abortedAfterTools) return abortedAfterTools;

          if (actionTools.length > 0) {
            didWork = true;
            consecutiveEmptyTurns = 0;
            consecutiveReasoningOnlyTurns = 0;
            retryAssistantMsgId = null;
            runStateAcc.toolRoundsTotal += 1;
            runStateAcc.lastAction = 'tool';
            if (clearsDynamicLoopAuditAwaiting(actionTools)) {
              dynamicLoopAuditAwaitingResponse = false;
              runStateAcc.continueWithoutProgress = 0;
            }
            const onlyContinue =
              actionTools.length > 0 &&
              actionTools.every(
                (tc) => normalizeRegisteredToolName(tc.name) === 'continue'
              ) &&
              summary.attempted > 0 &&
              summary.failed === 0;
            if (onlyContinue) {
              runStateAcc.continueWithoutProgress += 1;
              if (runStateAcc.continueWithoutProgress >= 4) {
                emit({
                  kind: 'agent-thought',
                  id: randomUUID(),
                  ts: Date.now(),
                  content:
                    'Several `continue` calls without substantive tool progress. Run tests, `edit`, or `ask_user` — do not keep self-prompting the same step.',
                  severity: 'warn'
                });
                runStateAcc.continueWithoutProgress = 0;
              }
            } else if (summary.attempted > 0 && summary.failed < summary.attempted) {
              runStateAcc.continueWithoutProgress = 0;
            }
            const directQuery = summarizeDirectToolArgs(actionTools);
            if (directQuery.length > 0) {
              query = clampQuery(`${opts.input.prompt} ${directQuery}`, opts.input.prompt);
            }
            if (summary.lastFailure) {
              lastToolRoundFailure = summary.lastFailure;
            }
            if (summary.attempted > 0 && summary.failed === summary.attempted) {
              const duplicateOnly =
                summary.failed > 0 && summary.duplicateFailures === summary.failed;
              if (!duplicateOnly) {
                resetSpinBuffer(spin);
                if (consecutiveBadToolRounds === 0 && summary.lastFailure) {
                  rootToolRoundFailure = summary.lastFailure;
                }
                consecutiveBadToolRounds += 1;
                if (consecutiveBadToolRounds >= MAX_SELF_CORRECTION_ATTEMPTS) {
                  log.warn('tool-round sustained failures — harness recovery', {
                    consecutiveBadToolRounds,
                    iteration: iter,
                    rootFailure: rootToolRoundFailure,
                    lastFailure: lastToolRoundFailure
                  });
                  emit({
                    kind: 'agent-thought',
                    id: randomUUID(),
                    ts: Date.now(),
                    content: formatToolRecoveryThought(
                      consecutiveBadToolRounds,
                      lastToolRoundFailure,
                      rootToolRoundFailure
                    ),
                    severity: 'warn'
                  });
                  runStateAcc.toolRecoveryCycles += 1;
                  resetSpinBuffer(spin);
                  consecutiveBadToolRounds = 0;
                  rootToolRoundFailure = undefined;
                  if (runStateAcc.toolRecoveryCycles >= 2 && opts.input.conversationId) {
                    const injected = await injectFollowUp({
                      followUp: {
                        id: randomUUID(),
                        kind: 'steering',
                        prompt: TOOL_ESCALATION_STEERING_PROMPT,
                        selection: { ...opts.input.selection },
                        queuedAt: Date.now(),
                        source: 'dynamic-loop'
                      },
                      runId: opts.input.runId,
                      conversationId: opts.input.conversationId,
                      workspacePath: opts.workspacePath,
                      workspaceId: opts.workspaceId,
                      emit,
                      messages,
                      signal: opts.signal
                    });
                    query = injected.query;
                    runStateAcc.lastAction = 'none';
                    continue;
                  }
                }
              }
            } else if (summary.attempted > 0) {
              consecutiveBadToolRounds = 0;
              rootToolRoundFailure = undefined;
              if (summary.failed < summary.attempted) {
                const sigs = actionTools
                  .filter((tc) => tc.name)
                  .map((tc) =>
                    toolCallSignature(tc.name!, tryParseArgumentsRecord(tc.argumentsBuf))
                  );
                pushToolRound(spin, sigs);
              }
              if (
                hostReportGatePendingTerminal &&
                actionTools.some(
                  (tc) => normalizeRegisteredToolName(tc.name) === 'report'
                )
              ) {
                log.info('host report gate — report succeeded; awaiting terminal finish', {
                  iteration: iter,
                  pendingTerminal: hostReportGatePendingTerminal
                });
                hostReportGatePendingTerminal = undefined;
              }
            }
          }
        }

        if (finishCall && actionTools.length > 0) {
          const steeredBeforeDeferredFinish = await consumeSteeringFollowUps(followUpCtx);
          if (steeredBeforeDeferredFinish) {
            query = await applyFollowUpAndPrefetch(steeredBeforeDeferredFinish, opts, invokedSkills, emit, messages);
            consecutiveEmptyTurns = 0;
            runStateAcc.lastAction = 'none';
            continue;
          }
          if (
            shouldInjectDynamicLoopAudit(
              actionTools,
              finishedToolCalls,
              dynamicLoopAuditAwaitingResponse,
              messages,
              runHistoryStartIndex,
              dynamicAuditInjectionCount,
              substantiveEditsAtLastAudit
            ) &&
            opts.input.conversationId
          ) {
            const auditedBeforeFinish = await injectDynamicLoopAudit(
              followUpCtx,
              opts.input.selection,
              messages,
              runHistoryStartIndex
            );
            if (auditedBeforeFinish) {
              query = await applyFollowUpAndPrefetch(auditedBeforeFinish, opts, invokedSkills, emit, messages);
              consecutiveEmptyTurns = 0;
              runStateAcc.lastAction = 'none';
              dynamicLoopAuditAwaitingResponse = true;
              dynamicAuditInjectionCount += 1;
              substantiveEditsAtLastAudit = countSubstantiveEdits(messages, runHistoryStartIndex);
              log.info('dynamic loop auto-audit injected before deferred finish', {
                iteration: iter,
                runId: opts.input.runId
              });
              continue;
            }
          }

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
          const queuedAfterTools = await tryConsumeQueueBeforeFinish(followUpCtx);
          if (queuedAfterTools) {
            query = await applyFollowUpAndPrefetch(queuedAfterTools, opts, invokedSkills, emit, messages);
            consecutiveEmptyTurns = 0;
            runStateAcc.lastAction = 'none';
            continue;
          }
          const gate = await maybeInterceptHostReportGate({
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            promptEventId: opts.input.promptEventId,
            reportsSettings,
            messages,
            query,
            nextIteration: iter + 1,
            consecutiveEmptyTurns,
            injectedStubsHighWater,
            consecutiveErrors,
            consecutiveBadToolRounds,
            runStateAcc,
            spin,
            pendingTerminal: 'finish',
            emit,
            runCumulativeTokens,
            runHistoryStartIndex
          });
          if (gate) return gate;
          return {};
        }

        if (askUserCall && actionTools.length > 0) {
          return pauseRunForAskUser({
            askUserCall,
            assistantText: turn.assistantText,
            reasoningText: turn.reasoningText,
            iteration: iter,
            runId: opts.input.runId,
            messages,
            query,
            nextIteration: iter + 1,
            consecutiveEmptyTurns,
            injectedStubsHighWater,
            consecutiveErrors,
            consecutiveBadToolRounds,
            runStateAcc,
            spin,
            runCumulativeTokens,
            dynamicLoopAuditAwaitingResponse,
            runHistoryStartIndex,
            emit,
            deferred: true
          });
        }

        const steeredAfterTools = await consumeSteeringFollowUps(followUpCtx);
        if (steeredAfterTools) {
          query = await applyFollowUpAndPrefetch(steeredAfterTools, opts, invokedSkills, emit, messages);
          consecutiveEmptyTurns = 0;
          runStateAcc.lastAction = 'none';
          continue;
        }

        // No per-iteration audit nudge here: the dynamic loop is model-directed.
        // The harness (`05-dynamic-loop.md`) tells Agent V to self-audit and
        // `continue` after substantive work; the host only injects a single
        // verify-before-finish net at the deferred-finish boundary above.
        if (didWork) continue;

        const proseText = turn.assistantText.trim();
        const hadNoTerminalTools =
          finishedToolCalls.length === 0 && !finishCall && !askUserCall;

        if (
          turn.hadReasoning &&
          !turn.hadText &&
          hadNoTerminalTools &&
          proseText.length === 0
        ) {
          consecutiveReasoningOnlyTurns += 1;
          if (consecutiveReasoningOnlyTurns < 2) {
            log.debug('reasoning-only turn — continuing without empty-turn strike', {
              iteration: iter,
              consecutiveReasoningOnlyTurns
            });
            runStateAcc.lastAction = 'retry';
            continue;
          }
          log.warn('reasoning-only cap reached — falling through to empty-turn handling', {
            iteration: iter,
            consecutiveReasoningOnlyTurns
          });
        }

        consecutiveReasoningOnlyTurns = 0;

        if (wrapUp && proseText.length > 0) {
          retryAssistantMsgId = null;
          runStateAcc.lastAction = 'answer';
          if (!turn.hadText) {
            emitFinalAnswer(emit, proseText);
          }
          log.info('iteration-cap wrap-up — accepting prose as final answer', {
            iteration: iter,
            textChars: proseText.length
          });
          return {};
        }

        if (wrapUp) {
          const wrapMsg =
            'Run stopped at the iteration limit without a final answer from the model.';
          emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: wrapMsg });
          return { terminalError: wrapMsg };
        }

        if (isImplicitFinish(proseText)) {
          // Substantive prose ends the run whether or not tools ran first.
          // Models that answer in prose instead of calling `finish` must not
          // have their completed, already-streamed answer aborted and retried
          // — that destroys the rendered answer (`agent-text-aborted` drops it
          // in the renderer) and, for prose-only models, can only flash, lose,
          // or duplicate the same text. Capable models close with an explicit
          // `finish` / `continue` and never reach this branch.
          retryAssistantMsgId = null;
          runStateAcc.lastAction = 'answer';
          log.info('implicit finish - substantive prose accepted as answer', {
            iteration: iter,
            textChars: proseText.length,
            toolRoundsTotal: runStateAcc.toolRoundsTotal
          });
          const queuedImplicit = await tryConsumeQueueBeforeFinish(followUpCtx);
          if (queuedImplicit) {
            query = await applyFollowUpAndPrefetch(queuedImplicit, opts, invokedSkills, emit, messages);
            consecutiveEmptyTurns = 0;
            runStateAcc.lastAction = 'none';
            continue;
          }
          const gate = await maybeInterceptHostReportGate({
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            promptEventId: opts.input.promptEventId,
            reportsSettings,
            messages,
            query,
            nextIteration: iter + 1,
            consecutiveEmptyTurns,
            injectedStubsHighWater,
            consecutiveErrors,
            consecutiveBadToolRounds,
            runStateAcc,
            spin,
            pendingTerminal: 'implicit-finish',
            emit,
            runCumulativeTokens,
            runHistoryStartIndex
          });
          if (gate) return gate;
          return {};
        }

        consecutiveEmptyTurns += 1;
        const proseToolCalls = looksLikeProseEmittedToolCalls(proseText);
        if (consecutiveEmptyTurns < 2) {
          log.warn(
            proseToolCalls
              ? 'assistant emitted prose tool JSON — retrying once'
              : 'assistant turn produced no tool call — retrying once',
            {
              iteration: iter,
              proseChars: proseText.length
            }
          );
          popProseOnlyAssistant(messages);
          if (turn.hadText || turn.hadReasoning) {
            emit({ kind: 'agent-text-aborted', id: turn.assistantMsgId, ts: Date.now() });
          }
          retryAssistantMsgId = turn.assistantMsgId;
          runStateAcc.lastAction = 'retry';
          continue;
        }
        {
          const haltMessage = proseToolCalls ? USER_PROSE_TOOL_CALL_ERROR : USER_EMPTY_TURN_ERROR;
          log.warn('empty-turn halt', {
            iteration: iter,
            consecutiveEmptyTurns,
            proseChars: proseText.length,
            proseToolCalls,
            technical: proseToolCalls
              ? 'The model printed tool-call JSON in prose after a retry — escalating to user.'
              : 'The model produced no tool call and no substantive answer after a retry — escalating to user.'
          });
          retryAssistantMsgId = null;
          emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: haltMessage });
          return { terminalError: haltMessage };
        }
    }
  } finally {
    opts.signal.removeEventListener('abort', disposeStreaming);
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

const QUESTION_MARK_CODEPOINTS = new Set<number>([
  0x3f /* '?' */,
  0xff1f /* '？' fullwidth */
]);

const SENTENCE_END_CODEPOINTS = new Set<number>([
  0x2e /* '.' */,
  0x21 /* '!' */,
  0x3002 /* '。' ideographic full stop */,
  0xff01 /* '！' fullwidth exclamation */
]);

function endsWithMeaningfulCodePoint(s: string, terminals: ReadonlySet<number>): boolean {
  let end = s.length;
  for (let steps = 0; steps < MAX_TRAILING_PROBE_STEPS && end > 0; steps++) {
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
    if (terminals.has(cp)) return true;
    if (!TRAILING_SKIP_CODEPOINTS.has(cp)) return false;
    end -= consumed;
  }
  return false;
}

export function endsWithQuestionMark(s: string): boolean {
  return endsWithMeaningfulCodePoint(s, QUESTION_MARK_CODEPOINTS);
}

/** True when prose ends with `.` / `!` (ASCII or common CJK/fullwidth forms). */
function endsWithSentenceEnd(s: string): boolean {
  return endsWithMeaningfulCodePoint(s, SENTENCE_END_CODEPOINTS);
}

function isProseToolCallObject(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim()) return false;
  return o.arguments !== undefined || o.args !== undefined;
}

function isProseToolCallJson(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.length > 0 && parsed.every(isProseToolCallObject);
    }
    return isProseToolCallObject(parsed);
  } catch {
    return false;
  }
}

/**
 * Models that lack native `tool_calls` sometimes emit fenced JSON like
 * `[{ "name": "read", "arguments": { ... } }]`. That is not a final
 * answer — treat it as a no-tool turn so the loop retries instead of
 * implicit-finish.
 */
export function looksLikeProseEmittedToolCalls(prose: string): boolean {
  const trimmed = prose.trim();
  if (!trimmed) return false;

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(trimmed)) !== null) {
    if (isProseToolCallJson(match[1].trim())) return true;
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return isProseToolCallJson(trimmed);
  }
  return false;
}

/**
 * True when prose-only assistant text should end the run without a
 * `finish` tool. Combines a char threshold with question-mark and
 * sentence-end probes so short direct answers and clarifying questions
 * clear the bar while filler ("Okay.") does not.
 */
export function isImplicitFinish(prose: string): boolean {
  const t = prose.trim();
  if (t.length === 0) return false;
  if (looksLikeProseEmittedToolCalls(t)) return false;
  if (t.length >= IMPLICIT_FINISH_MIN_CHARS) return true;
  if (endsWithQuestionMark(t)) return true;
  if (t.length >= IMPLICIT_FINISH_MIN_SENTENCE_CHARS && endsWithSentenceEnd(t)) return true;
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
  search: ['query', 'pattern', 'language'],
  sg: ['action', 'pattern', 'rulePath'],
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

async function resolveProviderEndpointHost(providerId: string): Promise<string | undefined> {
  try {
    const provider = await getProviderWithKey(providerId);
    if (!provider?.baseUrl) return undefined;
    return new URL(provider.baseUrl).host;
  } catch {
    return undefined;
  }
}

function formatConnectingLabel(providerName: string, endpointHost?: string): string {
  if (endpointHost && !providerName.toLowerCase().includes(endpointHost.toLowerCase())) {
    return `Connecting to ${providerName} (${endpointHost})…`;
  }
  return `Connecting to ${providerName}…`;
}

function emitRunStoppedThought(emit: (event: TimelineEvent) => void): void {
  emit({
    kind: 'agent-thought',
    id: randomUUID(),
    ts: Date.now(),
    content: RUN_STOPPED_THOUGHT,
    severity: 'info'
  });
}

function exitIfAborted(
  opts: { signal: AbortSignal },
  emit: (event: TimelineEvent) => void,
  runHadLlmProgress: boolean
): RunLoopResult | null {
  if (!opts.signal.aborted) return null;
  if (!runHadLlmProgress) {
    emitRunStoppedThought(emit);
  }
  return { aborted: true };
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
