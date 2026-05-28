/**
 * The orchestration loop body.
 *
 * Per iteration, in order:
 *   1. Refresh the dynamic envelopes (workspace context, recent memory,
 *      meta-rules) and rebuild the system message — this is what kept the
 *      agent honest about a moving workspace mid-run.
 *   2. Stream one assistant turn (`handleAssistantTurn`).
 *   3. Push the assistant message into history (with canonical OpenAI
 *      shape — null content when only tool_calls are emitted).
 *   4. If tool calls fired → execute them and continue.
 *   5. Else if `<delegate>` directives are present → spawn the swarm,
 *      verify, count strikes, inject the verified envelope, continue.
 *   6. Else → consult the planning-without-action heuristic. Either
 *      nudge & continue, or terminate.
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
  TimelineEvent,
  TokenUsage
} from '@shared/types/chat.js';
import type { ContextSummaryRules } from '@shared/types/contextSummary.js';
import { resolveContextSummaryRules } from '@shared/types/contextSummary.js';
import { selectEffectiveContextWindow } from '@shared/providers/contextWindow.js';
import { buildOrchestratorSystemPrompt } from '../../harness/harnessLoader.js';
import { probeWorkspaceOverridePresent } from '../../harness/probeOverride.js';
import { refreshEnvelopes } from '../contextManager.js';
import { parseDelegatesWithDuplicates, stripDelegates, type ParsedDelegate } from '../envelope/index.js';
import { backoff } from '../retry.js';
import { isAbortError } from '../abortSignal.js';
import { logger } from '../../logging/logger.js';
import {
  isNonRecoverableProviderError,
  isProviderError
} from '../../providers/providerError.js';
import {
  getProviderWithKey,
  listProviders
} from '../../providers/providerStore.js';
import { getSettings } from '../../settings/settingsStore.js';
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOTAL_ITERATIONS
} from '@shared/constants.js';
import { ORCHESTRATOR_TOOLS } from '../../tools/policy/index.js';
import {
  clearForRun,
  dropSnapshot as dropUndoSnapshot,
  getInspectorSnapshot,
  getSnapshot as getUndoSnapshot,
  maybeRunSummarization,
  revertSummary,
  shouldTrigger as shouldTriggerSummary
} from '../contextSummarizer/index.js';
import {
  registerRunContext,
  unregisterRunContext,
  type RunContextHandle
} from '../runContextRegistry.js';
import { broadcastSnapshotChanged } from '../../ipc/contextSummary.ipc.js';

import { buildSystemPrompt } from './buildSystemPrompt.js';
import { buildOrchestratorRequest } from './buildOrchestratorRequest.js';
import { handleAssistantTurn } from './handleAssistantTurn.js';
import { handleToolCalls } from './handleToolCalls.js';
import { handleDelegates, type DelegationCounters } from './handleDelegates.js';
import { handleNoToolNoDelegate, type NudgeState } from './handleNoToolNoDelegate.js';
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
  toolCallSignature
} from './toolSpinSignature.js';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState
} from './buildRunState.js';
import { buildHostEnvironmentXml } from './buildHostEnvironment.js';

const log = logger.child('orch/runLoop');

/**
 * Partition finished tool calls into real orchestrator calls and
 * hallucinated `delegate` function-calls that should be routed through
 * the directive flow instead.
 *
 * The model sometimes emits `delegate` as a tool_call despite the name
 * never appearing in the function-calling schema (observed on smaller /
 * Ollama-served models and occasionally on larger ones when the harness
 * prompt is front-of-mind). Converting them here avoids a wasted
 * refuse-and-retry round-trip.
 */
type FinishedToolCall = {
  id?: string;
  name?: string;
  argumentsBuf: string;
  thoughtSignature?: string;
};

export function extractDelegateToolCalls(finished: FinishedToolCall[]): {
  realToolCalls: FinishedToolCall[];
  toolSourcedDelegates: ParsedDelegate[];
} {
  const real: FinishedToolCall[] = [];
  const delegates: ParsedDelegate[] = [];
  for (const tc of finished) {
    if (tc.name !== 'delegate') {
      real.push(tc);
      continue;
    }
    // Best-effort parse of the tool-call args into a ParsedDelegate.
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(tc.argumentsBuf || '{}');
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON — fall through to the refusal path by treating
      // it as a real tool call (handleToolCalls will refuse it cleanly).
      real.push(tc);
      continue;
    }
    const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
    const task = typeof args['task'] === 'string' ? args['task'].trim() : '';
    if (!id || !task) {
      // Missing required fields — let handleToolCalls produce a
      // descriptive refusal so the model can self-correct.
      real.push(tc);
      continue;
    }
    // `files` and `tools` may arrive as a comma-separated string
    // (XML-directive style) or a JSON array (function-call style).
    const filesRaw = args['files'];
    const toolsRaw = args['tools'];
    const toList = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    };
    delegates.push({
      id,
      task,
      files: toList(filesRaw),
      tools: toList(toolsRaw)
    });
  }
  return { realToolCalls: real, toolSourcedDelegates: delegates };
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
   *  Defaults to the original user prompt; updated when nudges/sub-agent
   *  results land. */
  initialQuery: string;
  permissions: ChatPermissions;
  /** Strict-approvals flag for this run's workspace. */
  strictApprovals: boolean;
}

/** Outcome of a completed orchestrator loop (success, halt, or user abort). */
interface RunLoopResult {
  /** Set when the loop emitted a terminal `error` timeline row. */
  terminalError?: string;
}

export async function runOrchestratorLoop(opts: RunLoopOpts): Promise<RunLoopResult> {
  const harness = buildOrchestratorSystemPrompt();
  const messages = opts.initialMessages;
  let query = opts.initialQuery;

  // ── Context-summarization runtime state ────────────────────────────
  // Resolved once at run start, then re-resolved at the top of every
  // iteration (review finding H2) so a Settings → Context edit
  // mid-run lands on the very next auto-trigger evaluation. The
  // manual-trigger IPC also re-resolves at click time as a belt-
  // and-braces measure. Kept as a `let` because both paths refresh
  // it.
  let summaryRules: ContextSummaryRules = await resolveSummaryRulesForRun(
    opts.input.workspaceId
  );
  // Effective context-window ceiling for the run's selected model.
  // Used by `shouldTriggerSummary`. Static for the run.
  let summaryCeiling: number | undefined;
  try {
    const providers = await listProviders();
    summaryCeiling = selectEffectiveContextWindow(
      providers,
      opts.input.selection.providerId,
      opts.input.selection.modelId
    );
  } catch (err) {
    log.debug('failed to resolve context-window ceiling for summarizer', { err });
  }
  // Mutable accumulator written by the wrapped `emit` below — every
  // `token-usage` event the loop forwards updates this. The auto-
  // trigger predicate reads it at the top of each iteration.
  let latestUsage: TokenUsage | undefined;
  // Latest run-state XML, threaded into the summarizer's user
  // envelope so it sees the same loop snapshot the orchestrator does.
  let latestRunStateXml: string | undefined;
  // Set while a summary is mid-stream so the auto-trigger doesn't
  // double-fire and the manual IPC rejects with a friendly reason.
  // Updated by the `emit` wrapper below when the `context-summary-
  // pending` event lands — i.e. AFTER `streamSummary` has done its
  // partition / token estimation / system-prompt build work and is
  // about to start streaming the first delta. That window
  // (synchronous gate → `await streamSummary` → first emit) is
  // closed by `summarizationStarting` (H3); `activeSummaryId`
  // remains the authoritative handle once the pending event lands.
  let activeSummaryId: string | undefined;
  // H3: synchronous in-flight flag. The async window between a
  // trigger-gate check (`activeSummaryId === undefined`) and
  // `streamSummary` actually emitting `context-summary-pending`
  // spans several awaits (`partition`, `estimateRangeTokens`,
  // `buildSummarizerSystemPrompt`). Without this flag, two
  // concurrent trigger paths (auto + manual, or manual + manual
  // through two open Inspector windows) could both pass the gate
  // before either had emitted its pending marker. They'd then
  // race on `applySummary`'s in-place splice and the second one's
  // partition would be stale. The flag is set SYNCHRONOUSLY at
  // the top of each trigger and cleared in `finally` so both
  // success and failure paths release it.
  let summarizationStarting = false;
  /** True while the iteration body is executing — blocks context-summary undo. */
  let iterationInFlight = false;
  let sanitizeFingerprint: string | undefined;
  let sanitizeCached: SanitizeResult | undefined;
  /** Aborts only the summarizer fetch; the orchestrator run continues. */
  let summaryAbort: AbortController | null = null;
  let snapshotBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const SNAPSHOT_DEBOUNCE_MS = 250;
  const scheduleSnapshotBroadcast = (): void => {
    if (snapshotBroadcastTimer !== null) return;
    snapshotBroadcastTimer = setTimeout(() => {
      snapshotBroadcastTimer = null;
      broadcastSnapshotChanged(opts.input.runId);
    }, SNAPSHOT_DEBOUNCE_MS);
  };

  opts.signal.addEventListener(
    'abort',
    () => {
      summaryAbort?.abort();
    },
    { once: true }
  );

  const bindSummarySignal = (): AbortSignal => {
    summaryAbort?.abort();
    const ac = new AbortController();
    summaryAbort = ac;
    if (opts.signal.aborted) ac.abort();
    return ac.signal;
  };

  const releaseSummarySignal = (): void => {
    summaryAbort = null;
  };

  /** Populated once `registerRunContext` runs; mirrors usage/summary slots. */
  const runHandleRef: { current?: RunContextHandle } = {};

  // Single `emit` everything in the loop uses. Forwards to
  // `opts.emit` verbatim while side-channel-capturing the bits the
  // summarizer needs (latest usage, summary lifecycle markers).
  //
  // Phase 5 (2026) — every authoritative `token-usage` frame also
  // triggers a `CONTEXT_SUMMARY_SNAPSHOT_CHANGED` broadcast so an
  // open Context Inspector pulls a fresh wire-breakdown
  // synchronously with the composer pill. Pre-fix, the inspector
  // refreshed only on rules / override / manual-trigger / undo
  // events — its "% of context window used" reading would lag the
  // pill by entire iterations during a live run.
  const emit = (event: TimelineEvent): void => {
    if (event.kind === 'token-usage') {
      latestUsage = event.usage;
      if (runHandleRef.current) runHandleRef.current.latestUsage = event.usage;
      scheduleSnapshotBroadcast();
    } else if (event.kind === 'context-summary-pending') {
      activeSummaryId = event.summaryId;
      if (runHandleRef.current) runHandleRef.current.activeSummaryId = event.summaryId;
    } else if (
      event.kind === 'context-summary-end' ||
      event.kind === 'context-summary-aborted'
    ) {
      if (activeSummaryId === event.summaryId) {
        activeSummaryId = undefined;
        if (runHandleRef.current) runHandleRef.current.activeSummaryId = undefined;
      }
    }
    opts.emit(event);
  };

  // Phase 2 — FS-aware live diff streamer. One per run; shared
  // between the orchestrator's own turns and every spawned
  // sub-agent so a single source of truth produces the
  // `diff-stream` events. Owned by this function so the lifecycle
  // is unambiguous: instantiated here, disposed at every exit
  // point (success, halt, abort). The companion args-tap factory
  // owns a long-lived `PartialJsonParser` pool keyed by `callId`
  // so partial-JSON parsing stays O(delta) across the stream —
  // see the matching renderer-side pool in `chatChannel`.
  // Off-main-thread LCS pool. Lazily spawns a single worker the
  // first time a file exceeds `WORKER_THRESHOLD_BYTES` inside the
  // streamer. Owned here so the pool's `dispose()` runs alongside
  // the streamer's on every orchestrator-loop exit.
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

  // Phase 2 — guarantee disposal at every exit. The orchestrator
  // loop has many early-return branches (abort, halt, iteration
  // cap, error path, …) so attaching the dispose on the abort
  // signal AND on a single `try/finally` around the iteration
  // `for` loop covers every case without forcing the body to
  // change shape. The signal listener handles the cooperative-
  // abort path (where the signal fires before we reach the
  // for-loop's natural exit); the finally covers normal
  // termination + the explicit `return` exits inside the loop.
  //
  // Audit fix M-05: the `try { ... } finally { disposeStreaming() }`
  // block opens RIGHT HERE (immediately after `diffWorkerPool` and
  // `diffStreamer` are constructed) instead of further down. The
  // original placement opened the try AFTER `resolveProviderName`
  // (an `await`) and `registerRunContext` — so if either threw, the
  // for-loop's `finally` never executed and the diff-worker thread
  // pool leaked for the lifetime of the parent process. With the
  // try-block opened here, every throw between construction and
  // loop entry still routes through `disposeStreaming()` +
  // `unregisterRunContext()` in the finally.
  opts.signal.addEventListener('abort', disposeStreaming, { once: true });

  let runContextGeneration = 0;
  try {
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };
    const nudges: NudgeState = { used: 0 };
    /**
     * Hot-tool-call-signature ring buffer. Pure observability — the
     * value flows into `<run_state>.spin_signature_hot` so the model
     * can pivot before the per-run tool-result cache starts prepending
     * its "you already issued this" banner. See
     * `toolSpinSignature.ts` for the subtraction-pass rationale (the
     * old detector + nudge + halt path was redundant with the cache
     * banner and is gone).
     */
    const spin = createSpinSignatureBuffer();
    /**
     * Run-scoped set of delegate ids the orchestrator has already
     * emitted `subagent-pending` events for (T0-7). Hoisted from
     * `handleAssistantTurn` per-turn scope so a sub-iteration that
     * emits two assistant turns (rare provider behavior — return,
     * then continue) cannot re-emit a pending row for an id the
     * first turn already surfaced. The renderer reducer dedupes at
     * `subagent-spawn` time, so the previous duplication produced
     * a brief flicker rather than a corrupt state — but emitting
     * fewer redundant events is strictly better for the timeline.
     */
    const runScopedSeenDelegateIds = new Set<string>();
    /**
     * T0-6 — high-water mark for orphan-stub injections seen in this
     * run. The defensive sanitizer (`sanitizeToolCallPairingWithStats`)
     * walks `messages[]` every iteration; when a transcript carries a
     * stable orphan (a corrupted JSONL line that re-materialises on
     * every replay-then-rebuild path), the previous code emitted a
     * `phase` event PER iteration with the same N. The water-mark
     * gate below emits exactly ONE phase event per "new" orphan
     * detected — subsequent iterations that re-encounter the SAME
     * stable orphan stay silent on the timeline. Fresh orphans
     * (typically zero in practice) still emit a top-up phase event.
     */
    let injectedStubsHighWater = 0;
    let consecutiveErrors = 0;
    /**
     * Consecutive orchestrator iterations whose tool round attempted at
     * least one tool and saw EVERY result fail (`!ok`). Mirrors the
     * delegation-side `MAX_BAD_ROUNDS` so the harness's three-strike
     * rule is enforced for direct-tool failure cycles. Reset to 0 by
     * any tool round that produces at least one successful result, by
     * a clean delegate round, or by a clean termination branch.
     */
    let consecutiveBadToolRounds = 0;
    /**
     * Mutable run-state accumulator. Surfaced into the system prompt as
     * `<run_state>` each iteration so the model can self-regulate
     * (subtraction-principle replacement for several reactive
     * heuristics — see `buildRunState.ts`).
     */
    const runStateAcc = createRunStateAccumulator();

    /**
     * Provider display name with per-iteration freshness (T0-1).
     *
     * Resolved lazily at the top of every iteration so a mid-run
     * provider rename is reflected in the next `Connecting to <name>…`
     * status label, instead of pinning the name captured at run start.
     * One lookup per iteration is plenty — multiple status events
     * inside the same iteration share the cached value via this `let`
     * binding, and the underlying provider-store decrypt is itself
     * memoized.
     *
     * Falls back to the raw `providerId` UUID when the provider
     * record can't be loaded (deleted mid-run, decrypt failure) so
     * the user still sees a stable label rather than a blank one.
     */
    let providerName = await resolveProviderName(opts.input.selection.providerId);

    // Register this run's context for the contextSummary IPC handlers
    // and the inspector. Holds a live REFERENCE to `messages`; the
    // registry's reader contract is read-only — only the run loop and
    // `applySummary`/`revertSummary` mutate the array. Unregistered in
    // the `finally` block below regardless of how the loop exits.
    const runHandle: RunContextHandle = {
      runId: opts.input.runId,
      generation: 0,
      conversationId: opts.input.conversationId ?? '',
      workspaceId: opts.workspaceId,
      workspacePath: opts.workspacePath,
      messages,
      originalPrompt: opts.input.prompt,
      selection: opts.input.selection,
      rules: summaryRules,
      triggerManual: async () => {
        // H3: claim the synchronous in-flight gate FIRST so a
        // concurrent auto-trigger (or a second manual click via a
        // second open Inspector) can't race past while we await
        // the rules-resolve and the partition build below. Cleared
        // in `finally` so both success and failure release it.
        if (summarizationStarting || activeSummaryId !== undefined) {
          return { ok: false, reason: 'A summary is already in flight' };
        }
        summarizationStarting = true;
        try {
          // Re-resolve rules so a settings change between run start and
          // the click is honored. The summarizer model falls back to the
          // run's selection when `summarizerSelection === null`.
          summaryRules = await resolveSummaryRulesForRun(opts.input.workspaceId);
          runHandle.rules = summaryRules;
          if (!summaryRules.enabled) {
            return { ok: false, reason: 'Context summarization is disabled in settings' };
          }
          const summarizerSelection =
            summaryRules.summarizerSelection ?? opts.input.selection;
          const result = await maybeRunSummarization({
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            workspacePath: opts.workspacePath,
            messages,
            rules: summaryRules,
            summarizerSelection,
            trigger: 'manual',
            originalPrompt: opts.input.prompt,
            ...(latestRunStateXml !== undefined ? { runStateXml: latestRunStateXml } : {}),
            signal: bindSummarySignal(),
            emit
          });
          if (result.ok) return { ok: true, summaryId: result.summaryId };
          return { ok: false, reason: result.reason ?? 'Manual trigger failed' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          log.warn('manual summarization failed', { runId: opts.input.runId, reason });
          return { ok: false, reason };
        } finally {
          releaseSummarySignal();
          summarizationStarting = false;
        }
      },
      abortSummary: () => {
        if (!summarizationStarting && activeSummaryId === undefined) return false;
        summaryAbort?.abort();
        return true;
      },
      undo: async (summaryId: string) => {
        if (
          isContextSummaryUndoBlocked({
            iterationInFlight,
            summarizationStarting,
            activeSummaryId
          })
        ) {
          return { ok: false };
        }
        const snapshot = getUndoSnapshot(opts.input.runId, summaryId);
        if (!snapshot) return { ok: false };
        revertSummary({
          runId: opts.input.runId,
          summaryId,
          messages,
          preSplice: snapshot.preSplice
        });
        dropUndoSnapshot(opts.input.runId, summaryId);
        emit({
          kind: 'context-summary-undone',
          id: randomUUID(),
          ts: Date.now(),
          summaryId
        });
        return { ok: true };
      },
      snapshot: async () => {
        // Pull the freshest rules so a Settings → Context edit between
        // the last iteration and the Inspector open lands in the
        // surfaced rules. Cheap (one settings read).
        summaryRules = await resolveSummaryRulesForRun(opts.input.workspaceId);
        runHandle.rules = summaryRules;
        // Probe the workspace override file so the Inspector's badge
        // accurately reflects whether the bundled or the per-workspace
        // summarizer prompt is in effect for this run. Cheap: one
        // `stat` + (when present) one small `readFile`.
        const workspaceOverridePresent = await probeWorkspaceOverridePresent(
          opts.workspacePath
        );
        // ── Pre-iter-0 race fix ───────────────────────────────────
        // `buildInitialMessages` seeds `messages[0]` as a placeholder
        // `{ role: 'system', content: '' }` that the loop body fills
        // with the real `buildSystemPrompt(harness, env, runStateXml)`
        // on each iteration (see ~L553 below). There's a window
        // between `registerRunContext` (just above) and the iter-0
        // body where an Inspector IPC firing `runHandle.snapshot()`
        // would observe the empty placeholder and report
        // `systemPromptTokens === 0` — exactly the bug the idle path
        // had pre-fix. Detect the empty placeholder and build a
        // representative system prompt locally for the snapshot
        // view (without mutating the live array, which the loop
        // owns and will overwrite on its own schedule).
        let snapshotMessages: ChatMessage[] = messages;
        if (
          messages.length > 0 &&
          messages[0]?.role === 'system' &&
          (messages[0].content ?? '') === ''
        ) {
          try {
            const env = await refreshEnvelopes(
              query,
              opts.input.conversationId ?? '',
              opts.workspacePath,
              opts.input.workspaceId
            );
            const stateXml =
              latestRunStateXml ??
              buildRunStateXml(
                snapshotRunState(runStateAcc, counters, nudges, spin, consecutiveBadToolRounds)
              );
            // `<host_environment>` is rebuilt FRESH on every snapshot —
            // there is no per-run cache because the timestamp is the
            // entire point. The cost is microsecond-cheap (one Date +
            // a handful of synchronous os/process reads).
            const hostEnvXml = buildHostEnvironmentXml();
            const sysContent = buildSystemPrompt(harness, env, stateXml, hostEnvXml);
            snapshotMessages = [
              { role: 'system', content: sysContent },
              ...messages.slice(1)
            ];
          } catch (err) {
            log.debug('snapshot system-prompt rebuild failed; using live array', {
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }
        const snap = await getInspectorSnapshot({
          runId: opts.input.runId,
          conversationId: opts.input.conversationId ?? '',
          workspaceId: opts.workspaceId,
          messages: snapshotMessages,
          rules: summaryRules,
          workspaceOverridePresent,
          modelId: opts.input.selection.modelId,
          ...(summaryCeiling !== undefined ? { ceiling: summaryCeiling } : {}),
          ...(activeSummaryId !== undefined ? { activeSummaryId } : {})
        });
        return snap;
      }
    };
    runHandleRef.current = runHandle;
    runContextGeneration = registerRunContext(runHandle);

    for (let iter = 0; iter < MAX_TOTAL_ITERATIONS; iter++) {
      if (opts.signal.aborted) return {};
      iterationInFlight = true;
      try {
        const iterStartedAt = Date.now();

        // T0-1: refresh the provider name once per iteration so a
        // mid-run rename lands in the next status label. Cheap (the
        // provider store decrypt is itself cached). Skip on iter 0 — the
        // value resolved at run start is already authoritative for the
        // first iteration and a redundant lookup just adds latency to
        // the first `Connecting to…` row.
        if (iter > 0) {
          try {
            providerName = await resolveProviderName(
              opts.input.selection.providerId
            );
          } catch (err) {
            log.debug('per-iter provider name refresh failed; keeping prior', {
              providerId: opts.input.selection.providerId,
              iter,
              err: err instanceof Error ? err.message : String(err)
            });
          }
        }

        // H2: re-resolve `summaryRules` per iteration. Resolving only
        // once at run start meant a Settings → Context edit mid-run
        // wasn't honored by the auto-trigger until the user opened
        // the Inspector or clicked Trigger Manual. The resolver
        // reads through the memoized settings store so the cost is
        // a Map lookup on the happy path. Updating `runHandle.rules`
        // keeps the registry's mirror consistent for any concurrent
        // Inspector poll.
        try {
          summaryRules = await resolveSummaryRulesForRun(opts.input.workspaceId);
          runHandle.rules = summaryRules;
        } catch (err) {
          // Resolver failures already log inside `resolveSummaryRulesForRun`
          // and fall back to defaults; the next iteration retries.
          log.debug('per-iter summaryRules refresh failed; keeping prior', {
            runId: opts.input.runId,
            iter,
            err: err instanceof Error ? err.message : String(err)
          });
        }

        // Auto-trigger summarization. Fires when the previous
        // iteration's `token-usage` frame indicates the prompt-token
        // ratio crossed the configured threshold. The first iteration
        // always skips because no usage has been reported yet. The
        // call mutates `messages[]` in place via `applySummary` when
        // it lands; the next request build downstream sees the
        // compressed shape.
        //
        // H3: the trigger gate consults BOTH `summarizationStarting`
        // (synchronous claim) AND `activeSummaryId` (post-pending
        // state). The first defeats the auto-vs-manual race in the
        // partition/build window; the second covers the steady-
        // state mid-stream condition. We set `summarizationStarting
        // = true` SYNCHRONOUSLY here so a manual-trigger IPC that
        // lands during our `await maybeRunSummarization` sees the
        // claim and rejects with a friendly reason.
        if (
          iter > 0 &&
          !summarizationStarting &&
          activeSummaryId === undefined &&
          shouldTriggerSummary(latestUsage, summaryCeiling, summaryRules)
        ) {
          summarizationStarting = true;
          const summarizerSelection =
            summaryRules.summarizerSelection ?? opts.input.selection;
          try {
            await maybeRunSummarization({
              runId: opts.input.runId,
              conversationId: opts.input.conversationId ?? '',
              workspacePath: opts.workspacePath,
              messages,
              rules: summaryRules,
              summarizerSelection,
              trigger: 'auto',
              originalPrompt: opts.input.prompt,
              ...(latestRunStateXml !== undefined ? { runStateXml: latestRunStateXml } : {}),
              signal: bindSummarySignal(),
              emit
            });
          } catch (err) {
            // A summarizer failure is non-fatal — the orchestrator's
            // own retry loop will handle a downstream provider
            // context-overflow if compression couldn't land. Logged
            // for triage; the matching `context-summary-aborted`
            // event already surfaced the user-facing error.
            log.warn('auto-summarization failed; continuing without compression', {
              runId: opts.input.runId,
              iter,
              err: err instanceof Error ? err.message : String(err)
            });
          } finally {
            releaseSummarySignal();
            summarizationStarting = false;
          }
          // Re-check abort state — the streamer's `await` may have
          // observed a Stop click while we were compressing.
          if (opts.signal.aborted) return {};
        }

        // Refresh envelopes and rebuild the system message in-place. The
        // `conversationId` lets `contextManager` populate `<session_context>`
        // with title + prior-turn count so the agent can anchor short
        // continuation prompts to the current session instead of misreading
        // an empty `<recent_memory>` as a freshness signal (see screenshots
        // harness/02-context-and-memory.md).
        // Workspace-pinned envelopes. Passing both `workspacePath` (for the
        // top-level listing + memory retrieval) and `workspaceId` (for
        // `<prior_conversations>` filtering) keeps cross-workspace context
        // bleed structurally impossible — see contextManager docs.
        const env = await refreshEnvelopes(
          query,
          opts.input.conversationId,
          opts.workspacePath,
          opts.input.workspaceId
        );
        // Snapshot the live counters/nudges/spin into a `<run_state>` body
        // every iteration. The model uses this as a deterministic view of
        // its own loop position and can pre-emptively wrap up before any
        // host-side counter trips.
        runStateAcc.iteration = iter;
        runStateAcc.spinSignatureHot = spinHotSignature(spin);
        const runStateXml = buildRunStateXml(
          snapshotRunState(runStateAcc, counters, nudges, spin, consecutiveBadToolRounds)
        );
        // Stash for the summarizer's user-envelope builder (consumed
        // by both the auto-trigger above and the manual-trigger IPC
        // call). Updated even on iterations where no summarization
        // fires so a later click sees the freshest snapshot.
        latestRunStateXml = runStateXml;
        // Real-time host context (date/time + OS facts) — rebuilt every
        // iteration so the model never sees a stale timestamp. NOT
        // folded into `refreshEnvelopes` because that path has a 3s TTL
        // cache; real-time is the whole point of this surface. Cost is
        // microsecond-cheap (one Date + a handful of synchronous os/
        // process reads), so a per-iteration rebuild is well under
        // any noticeable latency budget.
        const hostEnvXml = buildHostEnvironmentXml();
        // `buildInitialMessages` always seeds `messages[0]` as a system
        // placeholder; refresh it in place each iteration.
        messages[0] = { role: 'system', content: buildSystemPrompt(harness, env, runStateXml, hostEnvXml) };

        // Defensive sanitizer (audit follow-up): replay and prior run aborts
        // can leave an `assistant.tool_calls` orphaned without its matching
        // `role:'tool'` responses. Strict OpenAI-compat providers
        // (DeepSeek/OpenAI/OpenRouter) reject the request with
        // `insufficient tool messages following tool_calls message`.
        // Inject stub responses for any orphans so the wire shape is always
        // valid — if a prior result was lost, the model sees a short
        // "result missing" placeholder and can re-issue.
        //
        // Observability (review finding H7): when stubs are injected we
        // surface a single `phase` event with the count so the user has a
        // triage breadcrumb. Without this, repeated stub injection on a
        // broken replay was silent at the user-facing layer (the model
        // proceeded correctly, but the user couldn't tell why the agent
        // appeared to "loop on missing data"). One event per iteration,
        // not per stub — count is enough.
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
        // T0-6: emit the recovery `phase` event only when the run has
        // seen a NEW orphan since the last emission. A stable orphan
        // (e.g. a corrupted JSONL line that re-materialises on every
        // replay-then-rebuild) used to spam one identical phase row
        // per iteration; the high-water gate below collapses that to
        // exactly one row per increment.
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
          // Phase 7 (2026): thread the conversation id so xAI Grok 4.x
          // hosts get a stable `x-grok-conv-id` for prompt-cache
          // attribution. Other dialects ignore the field — see
          // `attributionHeaders.ts` for the resolution rule.
          ...(opts.input.conversationId !== undefined
            ? { conversationId: opts.input.conversationId }
            : {})
        });

        // Three-phase wait surface so the user can tell where the latency
        // is coming from:
        //
        //   1. `preparing-turn` (iter > 0): we just folded in tool / sub-
        //      agent results and are about to issue the next request.
        //      Skipped on iter 0 because there's nothing to prepare yet.
        //   2. `connecting`: the HTTP request has gone out but the response
        //      headers haven't arrived. Dominates on cold-start serverless
        //      providers and bad networks.
        //   3. `awaiting-response`: connection is open, headers received,
        //      but the provider hasn't streamed the first token yet — this
        //      is the actual server-side "thinking" window. Flipped to
        //      `connecting` automatically once `streamChat`'s `onConnect`
        //      hook fires (see ChatStreamRequest.onConnect).
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

        const turn = await handleAssistantTurn(
          req,
          emit,
          argsDeltaTap,
          runScopedSeenDelegateIds
        );

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

        // Close out the streaming markers. Each end-marker is a no-op in the
        // reducer when no matching accumulator exists (`if (!prev) return`),
        // but emitting the symmetric pair only when the corresponding stream
        // actually produced bytes keeps the persisted transcript honest:
        // replay then sees a 1:1 delta→end correspondence per id.
        //
        // Skip the reasoning-end emission when `handleAssistantTurn` already
        // fired it mid-stream (reasoning → content transition). Re-emitting
        // here would overwrite the real reasoning-end timestamp with a much
        // later turn-end one, which would bloat the "Thought for Ns" label
        // with the time spent streaming the post-reasoning answer.
        if (turn.hadReasoning && !turn.reasoningEndEmitted) {
          // Pure-reasoning fallback: the stream ended without a content/
          // tool-call follow-up so `consumeChatStream` never fired the
          // mid-stream `onReasoningEnd`. Forward the Anthropic thinking
          // signature (when present) so a thinking-only Claude turn
          // round-trips its plan signature on the next request.
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
        // Lock in a stable id for each tool call BEFORE we push the assistant
        // message — see `lockToolCallIds` for the full id-flow contract.
        lockToolCallIds(finishedToolCalls);

        // ── Delegate-as-tool-call intercept ──────────────────────────
        //
        // Some models (especially smaller / Ollama-served ones)
        // hallucinate `delegate` as a function-call despite it never
        // appearing in the tool schema. Previously the allowlist
        // refused them and the model wasted a round-trip self-
        // correcting. We now intercept these, convert to
        // `ParsedDelegate` objects, and merge into the text-parsed
        // delegate flow.
        //
        // IMPORTANT: intercepted `delegate` calls MUST NOT appear in
        // the assistant message's `tool_calls` array and MUST NOT get
        // synthetic `role:'tool'` rows here. Delegation outcomes land
        // in the `<subagent_results>` user envelope from
        // `handleDelegates` instead. The prior implementation pushed
        // synthetic tool results *before* the assistant turn and still
        // recorded the delegate ids in `tool_calls`, which left every
        // call orphaned once `sanitizeToolCallPairing` ran on the next
        // iteration (tool rows preceded their assistant → dropped; ids
        // in `tool_calls` had no matching responses → stubbed → the
        // user-visible "Recovered N orphan tool_call(s)" phase spam).
        const { realToolCalls, toolSourcedDelegates } =
          extractDelegateToolCalls(finishedToolCalls);
        if (toolSourcedDelegates.length > 0) {
          log.info('converted delegate tool-call(s) to directives', {
            count: toolSourcedDelegates.length,
            ids: toolSourcedDelegates.map((d) => d.id)
          });
        }

        // Per-iteration summary log. Structured so triage can grep one line
        // to see exactly what happened in any iteration: tool-call count,
        // delegate presence, text/reasoning lengths, finish reason, wall-
        // clock. Lands at `debug` in production so streaming-heavy runs
        // don't flood the log file.
        log.debug('iteration summary', {
          iteration: iter,
          runId: opts.input.runId,
          conversationId: opts.input.conversationId,
          finishReason: turn.finishReason,
          toolCalls: realToolCalls.length,
          delegateToolCallsConverted: toolSourcedDelegates.length,
          textChars: turn.assistantText.length,
          reasoningChars: turn.reasoningText.length,
          ms: Date.now() - iterStartedAt
        });

        // Push the assistant turn into history. Canonical OpenAI: null content
        // when only tool_calls are emitted.
        const assistantContent: string | null =
          (realToolCalls.length > 0 || toolSourcedDelegates.length > 0) && turn.assistantText.length === 0
            ? null
            : turn.assistantText;
        messages.push({
          role: 'assistant',
          content: assistantContent,
          ...(turn.reasoningText.length > 0 ? { reasoning_content: turn.reasoningText } : {}),
          // Phase 8 (2026): persist the Anthropic thinking signature on
          // the assistant turn so the next request echoes the
          // `{type:'thinking', thinking, signature}` block back unchanged.
          // Required by Claude thinking-capable models for plan
          // continuity across turns; ignored by every other dialect.
          ...(typeof turn.reasoningSignature === 'string' && turn.reasoningSignature.length > 0
            ? { reasoning_signature: turn.reasoningSignature }
            : {}),
          ...(realToolCalls.length > 0
            ? {
              tool_calls: realToolCalls.map((tc) => ({
                id: tc.id!,
                type: 'function' as const,
                function: {
                  name: tc.name ?? 'unknown',
                  arguments: tc.argumentsBuf || '{}'
                },
                // Phase 9 (2026): persist Gemini's per-call
                // `thoughtSignature` so the next request round-trips
                // it onto the matching `functionCall` part. Other
                // dialects emit no signature; the field stays absent.
                ...(typeof tc.thoughtSignature === 'string' && tc.thoughtSignature.length > 0
                  ? { thoughtSignature: tc.thoughtSignature }
                  : {})
              }))
            }
            : {})
        });

        // 1) Tool calls (orchestrator's restricted set: ls/memory/recall — `read` is
        //    NOT in this surface; file contents enter the run only via sub-agent
        //    delegation. See `tools/policy/orchestratorTools.ts`.)
        //
        // Defense-in-depth: pass `ORCHESTRATOR_TOOLS` as an explicit allowlist
        // even though the function-calling schema already exposes only that
        // surface. A misbehaving model — or a provider compat layer (gemma3
        // and similar small models on Ollama have been observed doing this)
        // that promotes a model's native non-OpenAI tool-call format into a
        // `tool_calls` block regardless of schema — could otherwise smuggle
        // an `edit` / `bash` / `delete` call through orchestrator dispatch
        // and bypass the entire delegate pattern. The harness already
        // documents this enforcement (`01-orchestration-loop.md` §B
        // Tool restriction); now `handleToolCalls` actually performs it for
        // the orchestrator path. Refused calls answer with a synthetic
        // `role:"tool"` message telling the model to use `<delegate>`,
        // matching the sub-agent allowlist refusal surface.
        if (realToolCalls.length > 0) {
          const summary = await handleToolCalls(realToolCalls, messages, emit, {
            workspacePath: opts.workspacePath,
            workspaceId: opts.workspaceId,
            runId: opts.input.runId,
            conversationId: opts.input.conversationId ?? '',
            permissions: opts.permissions,
            strictApprovals: opts.strictApprovals,
            signal: opts.signal,
            allowlist: ORCHESTRATOR_TOOLS,
            onToolCallSettled
          });
          // If the user aborted while the tools were running, exit before we
          // burn another iteration on a stale stream request.
          if (opts.signal.aborted) return {};
          runStateAcc.directToolRoundsTotal += 1;
          runStateAcc.childRedelegationsTotal += summary.childRedelegations;
          runStateAcc.lastAction = 'direct-tool';

          // Refresh the rolling memory-retrieval query with a cheap summary
          // of THIS round's tool arguments (paths, keys, etc.). Without
          // this, a long direct-tool exploration kept retrieving against
          // the original user prompt forever — narrowing focus via `ls
          // src/main/orchestrator` produced zero improvement in the
          // `<recent_memory>` notes the next iteration saw. The summary
          // is bounded (string-typed args only, capped per call) so it
          // can never grow unbounded across a run. See
          // `summarizeDirectToolArgs` for the extraction policy.
          const directQuery = summarizeDirectToolArgs(realToolCalls);
          if (directQuery.length > 0) {
            // Keep the original user prompt as the anchor and append the
            // fresh exploration signal. Bounded by `MAX_QUERY_CHARS` so
            // long ls-tree paths don't bloat downstream retrieval cost.
            // T0-4: the clamp now reserves a stable head for the prompt
            // so the goal verb is never dropped on long prompts.
            query = clampQuery(`${opts.input.prompt} ${directQuery}`, opts.input.prompt);
          }

          // Three-strike rule for direct tool failures. Only counts when at
          // least one tool actually ran and EVERY one failed — partial
          // success or empty rounds are treated as progress and reset the
          // counter so the model gets a fresh budget once it recovers.
          if (summary.attempted > 0 && summary.failed === summary.attempted) {
            consecutiveBadToolRounds += 1;
            // Any failed round also resets the hot-signature buffer —
            // a round that FAILED is definitionally not an "all-OK but
            // no progress" loop, and the three-strike path already
            // owns this case. Clearing the buffer keeps
            // `<run_state>.spin_signature_hot` from surfacing the
            // failed signature on the next iteration.
            resetSpinBuffer(spin);
            if (consecutiveBadToolRounds >= MAX_SELF_CORRECTION_ATTEMPTS) {
              log.warn('three-strike halt — consecutive failed tool rounds', {
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
          } else {
            consecutiveBadToolRounds = 0;
            // Symmetry with the delegate branch below: a successful
            // direct-tool round is real progress and should CLEAR the
            // cross-round delegation strike budget as well. Without this,
            // the pattern [delegate-fail, delegate-fail, direct-ok,
            // delegate-fail] terminated the run at the third delegate fail
            // even though genuine intervening progress had landed. See
            // audit Phase 5.
            counters.consecutiveBadRounds = 0;
          }

          // Hot-tool-call-signature surfacing. After every successful
          // round we push a signature set into the ring buffer so that
          // `spinHotSignature(spin)` (computed at the top of the next
          // iteration into `<run_state>.spin_signature_hot`) reflects
          // the latest pattern. NO host-side nudge or halt is wired:
          // the per-run `toolResultCache` already prepends a banner to
          // identical calls from the SECOND repeat onward and the
          // harness §B "Don't re-survey what you've already seen" tells
          // the model what to do when it sees the banner. Subtraction-
          // pass: the previous spin nudge / halt block was redundant
          // with the cache + harness pair and was removed.
          if (summary.attempted > 0 && summary.failed < summary.attempted) {
            const sigs = realToolCalls
              .filter((tc) => tc.name)
              .map((tc) => {
                let args: Record<string, unknown> = {};
                try {
                  const parsed: unknown = JSON.parse(tc.argumentsBuf || '{}');
                  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    args = parsed as Record<string, unknown>;
                  }
                } catch (err) {
                  // Audit fix M-10: surface malformed tool-call args at
                  // the runLoop spin-signature site (the Ollama
                  // transport already warn-logs the same condition).
                  // Without this log, the downstream tool fails with
                  // "missing <param>" and the user / model can't tell
                  // whether the model produced bad JSON or the tool
                  // schema regressed.
                  log.warn('tool-call argumentsBuf JSON.parse failed; using {} for signature', {
                    toolName: tc.name,
                    rawPreview: (tc.argumentsBuf || '').slice(0, 200),
                    err: err instanceof Error ? err.message : String(err)
                  });
                  args = {};
                }
                return toolCallSignature(tc.name!, args);
              });
            pushToolRound(spin, sigs);
          }
          // Fall through to delegate parsing — the model may emit
          // orchestrator tools AND `<delegate />` directives in the
          // same assistant turn. Previously we `continue`d here and
          // silently skipped same-turn delegates.
        }

        // 2) Delegate directives.
        //
        // `parseDelegatesWithDuplicates` returns both the deduped directive
        // list AND the ids it dropped because they appeared twice in the
        // same turn. Without the duplicates surface, a model emitting two
        // `<delegate id="A1" …/>` directives saw only ONE spawn with no
        // signal that the second was silently dropped (review finding
        // B1). We emit a `phase` event so the user sees the drop in the
        // timeline, and log it for ops triage — keeping the
        // first-occurrence-wins semantics unchanged.
        const {
          directives: delegates,
          duplicates: droppedDelegateIds,
          malformedOpeners,
          compoundTaskIds
        } = parseDelegatesWithDuplicates(turn.assistantText);
        if (droppedDelegateIds.length > 0) {
          const uniqueDropped = Array.from(new Set(droppedDelegateIds));
          log.warn('dropped duplicate delegate directive(s)', {
            ids: uniqueDropped,
            totalDroppedOccurrences: droppedDelegateIds.length
          });
          emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label:
              `Skipped ${uniqueDropped.length} duplicate sub-agent request${uniqueDropped.length === 1 ? '' : 's'} ` +
              `(${uniqueDropped.join(', ')}) — only the first occurrence ran.`,
            tooltip:
              `Internal: <delegate id="…"/> repeated within the same orchestrator turn ` +
              `for id${uniqueDropped.length === 1 ? '' : 's'} ${uniqueDropped.join(', ')}. ` +
              'First-occurrence-wins by design.'
          });
        }
        // Malformed-opener surface (review finding M7). The
        // `malformedOpeners` array is a reserved slot on the parser
        // result — under today's `DELEGATE_RE` it is always empty
        // (newlines are already allowed in both attribute separators
        // and values, so genuine multi-line directives parse
        // cleanly). The emit-site stays wired so a future-discovered
        // malformed-opener pattern lands here as a `phase` event
        // without further plumbing; see `ParseDelegatesResult` for
        // the contract.
        if (malformedOpeners.length > 0) {
          log.warn('rejected malformed <delegate> opener(s)', {
            count: malformedOpeners.length,
            openersHead: malformedOpeners
          });
          emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label:
              `Skipped ${malformedOpeners.length} malformed sub-agent request${malformedOpeners.length === 1 ? '' : 's'} ` +
              '— the orchestrator could not parse the directive shape.',
            tooltip:
              'Internal: <delegate …/> opener did not match the harness directive shape. ' +
              'Expected: <delegate id="…" task="…" [files="…"] [tools="…"] />.'
          });
        }
        if (compoundTaskIds.length > 0) {
          const uniqueCompound = Array.from(new Set(compoundTaskIds));
          log.warn('rejected compound delegate task(s)', { ids: uniqueCompound });
          emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label:
              `Skipped ${uniqueCompound.length} compound sub-agent request${uniqueCompound.length === 1 ? '' : 's'} ` +
              `(${uniqueCompound.join(', ')}) — split into one micro-task per <delegate/>.`,
            tooltip:
              'Internal: <delegate task="…"> bundled multiple outcomes (compound directive). ' +
              'Harness contract: one micro-task per <delegate/> so verification stays unambiguous.'
          });
          messages.push({
            role: 'user',
            content:
              `The host rejected compound <delegate> directive(s) (id${uniqueCompound.length === 1 ? '' : 's'}: ` +
              `${uniqueCompound.join(', ')}). Each <delegate/> must carry exactly ONE micro-task in ` +
              `task="…". Re-emit separate directives — one outcome per id — instead of bundling multiple ` +
              `bullets or semicolon-separated goals into a single task.`
          });
        }
        // Merge any tool-sourced delegates (intercepted above) with
        // text-parsed ones. Dedupe by id — text-parsed wins on
        // collision (unlikely but defensive).
        const textIds = new Set(delegates.map((d) => d.id));
        const merged = [
          ...delegates,
          ...toolSourcedDelegates.filter((d) => !textIds.has(d.id))
        ];
        if (merged.length > 0) {
          // A delegate round is independent of direct-tool retries; reset
          // the strike counter so a later tool failure starts a fresh budget.
          consecutiveBadToolRounds = 0;
          // Delegation is real progress — the hot-signature buffer
          // tracks same-level tool rounds only, so we drop the
          // window when we leave that level.
          resetSpinBuffer(spin);
          const outcome = await handleDelegates(
            merged,
            messages,
            counters,
            emit,
            {
              selection: opts.input.selection,
              providerName,
              workspacePath: opts.workspacePath,
              workspaceId: opts.workspaceId,
              runId: opts.input.runId,
              conversationId: opts.input.conversationId ?? '',
              permissions: opts.permissions,
              strictApprovals: opts.strictApprovals,
              signal: opts.signal,
              argsDeltaTap,
              onToolCallSettled
            }
          );
          if (outcome === 'halt') {
            return {
              terminalError: `${MAX_DELEGATION_BAD_ROUNDS} consecutive sub-agent rounds failed verification — escalating to user.`
            };
          }
          // If the user aborted during the swarm, don't loop again.
          if (opts.signal.aborted) return {};
          runStateAcc.delegateRoundsTotal += 1;
          runStateAcc.lastAction = 'delegate';
          // Refresh the rolling memory-query with a synopsis of delegated
          // work. Clamped through the same `MAX_QUERY_CHARS` bound the
          // direct-tool branch uses so both paths cannot blow past it.
          // T0-4: the clamp now reserves a stable head for the prompt
          // so the goal verb survives long delegate-task lists.
          query = clampQuery(
            merged.map((d) => d.task).join(' '),
            opts.input.prompt
          );
          continue;
        }

        if (realToolCalls.length > 0) {
          continue;
        }

        // 3) Plain assistant text → either nudge to continue or terminate.
        // A substantive text turn is real progress — any prior spin window
        // is invalidated. The terminus heuristic itself is now tiny: it
        // only fires on reasoning-only empty turns. Substantive answers,
        // clarifying questions, completion narrations, and turns that
        // contain a partial / unclosed `<delegate>` tag all flow through
        // to the clean terminate branch — the consolidated harness and
        // the `<run_state>` envelope handle the language-level guidance.
        const cleanText = stripDelegates(turn.assistantText).trim();
        if (cleanText.length > 0) resetSpinBuffer(spin);
        const outcome = handleNoToolNoDelegate(
          cleanText,
          turn.finishReason,
          turn.hadReasoning,
          messages,
          nudges,
          emit
        );
        if (outcome === 'continue') {
          runStateAcc.lastAction = 'nudge';
        } else {
          // Terminus branch. Distinguish a clarifying-question turn from a
          // delivered answer so the run-state surface stays meaningful for
          // any subsequent turn the user sends. Both are clean termini for
          // THIS run.
          //
          // The probe walks BACKWARD past trailing punctuation/whitespace
          // (`)`, `]`, `}`, `"`, `'`, `”`, `’`, `」`, etc.) to find the
          // last meaningful code point. This was previously a single
          // `codePointAt(length - 1)` check which mis-classified lines
          // ending with `?)`, `?"`, or `？)` as `'answer'` — a real edge
          // case for clarifying questions wrapped in parenthetical or
          // quoted form. The new probe is a small bounded loop (capped at
          // 8 trailing code units to avoid pathological inputs); when no
          // meaningful char is found, we still fall through to `'answer'`.
          runStateAcc.lastAction = endsWithQuestionMark(cleanText) ? 'clarify' : 'answer';
          return {};
        }
      } finally {
        iterationInFlight = false;
      }
    }

    log.warn('iteration cap reached — halting run', {
      cap: MAX_TOTAL_ITERATIONS,
      runId: opts.input.runId,
      conversationId: opts.input.conversationId
    });
    emit({
      kind: 'error',
      id: randomUUID(),
      ts: Date.now(),
      message: `Iteration cap (${MAX_TOTAL_ITERATIONS}) reached.`
    });
    return { terminalError: `Iteration cap (${MAX_TOTAL_ITERATIONS}) reached.` };
  } finally {
    // Phase 2 — guarantee disposal of the run-level diff streamer +
    // the partial-JSON parser pool. Runs on every exit from the
    // iteration loop: clean return, halt, iteration cap, thrown
    // exception. The signal-listener path above is idempotent
    // (the streamer's `dispose()` is safe to call twice).
    //
    // Throw-safety (review finding H2): each cleanup step is
    // independently try/caught so a throw from `disposeStreaming()`
    // (e.g., the underlying `DiffWorkerPool.dispose` rejecting on a
    // worker `terminate`) cannot skip the subsequent
    // `clearForRun` / `unregisterRunContext` calls. Without this,
    // a single failed disposal would leak the run's context-summary
    // undo snapshots AND the registry entry for the entire parent-
    // process lifetime, growing memory linearly with the number of
    // failed runs. Mirrors the pattern `AgentV.startRun`'s `finally`
    // already uses for `finalizeCheckpointRun`.
    if (snapshotBroadcastTimer !== null) {
      clearTimeout(snapshotBroadcastTimer);
      snapshotBroadcastTimer = null;
    }
    try {
      disposeStreaming();
    } catch (err) {
      log.debug('disposeStreaming threw during runLoop cleanup', {
        runId: opts.input.runId,
        err: err instanceof Error ? err.message : String(err)
      });
    }
    try {
      clearForRun(opts.input.runId);
    } catch (err) {
      log.debug('clearForRun threw during runLoop cleanup', {
        runId: opts.input.runId,
        err: err instanceof Error ? err.message : String(err)
      });
    }
    try {
      unregisterRunContext(opts.input.runId, runContextGeneration);
    } catch (err) {
      log.debug('unregisterRunContext threw during runLoop cleanup', {
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

/** Blocks context-summary undo while the loop or summarizer owns `messages`. */
export function isContextSummaryUndoBlocked(state: {
  iterationInFlight: boolean;
  summarizationStarting: boolean;
  activeSummaryId: string | undefined;
}): boolean {
  return (
    state.iterationInFlight ||
    state.summarizationStarting ||
    state.activeSummaryId !== undefined
  );
}

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.argumentsBuf || '{}');
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
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
 * Resolve the fully-collapsed `ContextSummaryRules` for a run.
 *
 * Layering precedence (most → least specific):
 *   1. Workspace patch  → `AppSettings.ui.contextSummaryByWorkspace[wsId]`
 *   2. Global patch     → `AppSettings.contextSummary`
 *   3. Build-time defaults (`DEFAULT_CONTEXT_SUMMARY_RULES`)
 *
 * Both the auto-trigger and the manual IPC re-resolve via this
 * helper. Cheap — `getSettings()` is a memoized read.
 */
async function resolveSummaryRulesForRun(
  workspaceId: string | undefined
): Promise<ContextSummaryRules> {
  try {
    const settings = await getSettings();
    const global = settings.contextSummary;
    const workspace = workspaceId
      ? settings.ui?.contextSummaryByWorkspace?.[workspaceId]
      : undefined;
    return resolveContextSummaryRules(global, workspace);
  } catch (err) {
    log.warn('failed to resolve summary rules; using defaults', {
      workspaceId,
      err: err instanceof Error ? err.message : String(err)
    });
    return resolveContextSummaryRules(undefined, undefined);
  }
}

// Note (review finding M2): the local `probeWorkspaceOverridePresent`
// helper that used to live here is now imported from
// `../../harness/probeOverride.js`. The old copy used dynamic
// imports of `node:fs`, `node:path`, and `@shared/constants.js` on
// every call — the Inspector polls this via `runHandle.snapshot()`
// every time the user opens the panel, so the module-resolution
// cost on the hot path was noticeable. Centralising the helper
// keeps the implementation single-source-of-truth and the imports
// at module-load time.
