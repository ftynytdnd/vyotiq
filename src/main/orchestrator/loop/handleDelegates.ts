/**
 * Delegate-phase handler.
 *
 * Spawns the parallel sub-agent pool for a single delegation round, hooks
 * the swarm telemetry into the timeline (with per-sub-agent attribution),
 * verifies each output, increments the cross-round failure counter, and
 * pushes the canonical `<subagent_results>` envelope back onto the
 * orchestrator's message history.
 *
 * The 3-strike rule:
 *   - If three consecutive delegation rounds end with EVERY sub-agent
 *     verdict being `failed` or `malformed`, we emit an `error` event and
 *     return `'halt'`. The caller exits the loop.
 *
 * Per-sub-agent attribution:
 *   - Tool-result events streamed from sub-agents are tagged with
 *     `subagentId: spec.id` so the renderer can group them under the
 *     correct sub-agent trace card. The id is threaded through the
 *     `onToolResult(result, subagentId)` callback so attribution is
 *     strict under concurrent execution (no shared mutable ref).
 */

import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
import type {
  ChatMessage,
  ChatPermissions,
  TimelineEvent
} from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { ParsedDelegate } from '../envelope/index.js';
import { runSubAgentPool } from '../SubAgentPool.js';
import { verifySubagentRun } from '../verifier.js';
import { buildSubagentResultsEnvelope } from '../envelope/index.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';
import { listForConversation as listPendingChanges } from '../../checkpoints/pendingChanges.js';
import type { PendingChange } from '@shared/types/checkpoint.js';
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_FILES_PER_DELEGATE,
  MAX_PARALLEL_SUBAGENTS,
  MAX_PER_TASK_BAD_STREAK
} from '@shared/constants.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';
import type { ArgsDeltaTap } from './handleAssistantTurn.js';
import { validateSubagentToolsetDetailed } from '../../tools/policy/index.js';
import { malformedReasonFromAttrs } from '../malformedReason.js';
import {
  verifyDelegateArtifacts,
  formatHostVerificationXml
} from '../verifyDelegateArtifacts.js';

const log = logger.child('orch/delegates');

export interface DelegationCounters {
  /** Number of consecutive delegation rounds that ended in total failure. */
  consecutiveBadRounds: number;
  /**
   * Per-task bad-verdict streak. Keyed by a stable signature of the
   * sub-agent task (first 80 chars + sorted files), the value is the
   * number of CONSECUTIVE rounds in which a task with that signature
   * received a `self-failed` or `malformed` verdict.
   *
   * Mixed rounds reset `consecutiveBadRounds` but were previously a
   * blind spot for tasks that fail repeatedly while siblings succeed
   * (see `e6859f7b-...jsonl`: `App.tsx` edits failed across D1,
   * D1_retry, ... while sibling sub-agents reported success). This
   * map closes that gap.
   *
   * A task's entry is incremented on a bad verdict and DELETED on
   * any OK verdict for the same signature in the same round, so the
   * map size stays bounded by "tasks the model is currently retrying
   * in vain". Surfaced to the model via `<run_state>.failing_tasks`
   * when any value crosses `MAX_PER_TASK_BAD_STREAK - 1` so it can
   * pivot decomposition before the soft threshold trips.
   */
  perTaskBadStreak: Map<string, number>;
}

/**
 * Stable signature for a sub-agent task. Keep deterministic — used as
 * a map key. Truncating the task to its first 80 chars defends against
 * the model padding semantically identical tasks with different
 * preamble (e.g. "Retry the failed edit: ..." vs "Re-attempt: ..."). A
 * sorted file list collapses re-ordering noise. Module-private —
 * only consumed by the per-task strike accounting at the bottom of
 * `applyDelegateVerdict` further down this file.
 */
function taskSignature(task: string, files: ReadonlyArray<string>): string {
  const head = task.trim().slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
  const sortedFiles = Array.from(files).sort().join(',');
  return `${head}|${sortedFiles}`;
}

export interface HandleDelegatesOpts {
  selection: ModelSelection;
  /**
   * Provider display name resolved by the orchestrator at run start.
   * Threaded to each sub-agent so its `Connecting to <name>…` status
   * label surfaces a human-readable provider rather than the raw
   * `providerId` UUID. Falls back to `selection.providerId` when the
   * orchestrator could not resolve a name (deleted record / decrypt
   * failure) — the worker's label code applies the same fallback.
   */
  providerName: string;
  workspacePath: string;
  /** Workspace id (registry id) — required for checkpoint snapshots. */
  workspaceId: string;
  /** Run id (orchestrator-assigned). */
  runId: string;
  /** Conversation id that owns the run. */
  conversationId: string;
  permissions: ChatPermissions;
  /** Strict-approvals flag for this run's workspace. */
  strictApprovals: boolean;
  signal: AbortSignal;
  /**
   * Optional Phase 2 hook — see `handleAssistantTurn.ArgsDeltaTap`.
   * Threaded through `runSubAgentPool` so the run-level streamer
   * sees worker-scoped `tool-call-args-delta` snapshots and can
   * emit `diff-stream` events attributed to the right
   * `subagentId`. No-op when omitted.
   */
  argsDeltaTap?: ArgsDeltaTap;
  /**
   * Optional Phase 2 notification — invoked the moment an
   * authoritative `tool-call` event is about to be emitted, so the
   * run-level diff streamer can settle its in-flight diff stream
   * for that callId.
   *
   * `owner` is forwarded so the streamer can fold a still-pending
   * `pending:${subagentId}:${index}` surrogate `CallState` into
   * the real id if the provider transitioned `id` from `undefined`
   * mid-stream. The matching `subagentId` is passed here.
   */
  onToolCallSettled?: (callId: string, owner?: string, index?: number) => void;
}

export type DelegationOutcome = 'continue' | 'halt';

export async function handleDelegates(
  delegates: ParsedDelegate[],
  messages: ChatMessage[],
  counters: DelegationCounters,
  emit: (event: TimelineEvent) => void,
  opts: HandleDelegatesOpts
): Promise<DelegationOutcome> {
  const startedAt = Date.now();
  log.info('delegation round starting', {
    count: delegates.length,
    ids: delegates.map((d) => d.id),
    modelId: opts.selection.modelId
  });
  // Validate every delegate's `files` list against the active
  // workspace BEFORE the pool spawns. The model frequently invents
  // paths — e.g. `core/agent.py` in a TypeScript repo (see
  // screenshot §1) — and silently feeding those into the worker's
  // `inlineFiles` produced an empty `<files>` block while the UI
  // still chipped the bogus path as if it were real.
  //
  // We pre-compute a `missingFiles[]` per spec, surface it on the
  // spawn event so the renderer can mark the bad chips distinctly,
  // and pass the FILTERED file list into the worker so the actual
  // tool budget is spent on paths that exist. Validation is best-
  // effort: any spec that survives with at least one resolvable
  // path runs as before; a spec where EVERY path was invented
  // still runs (the worker can fall back to the orchestrator's
  // pre-seeded workspace context envelope) — we just won't
  // pollute the prompt with phantom files.
  const validatedSpecs = await Promise.all(
    delegates.map(async (d) => {
      const { resolved, missing } = await classifyFiles(d.files, opts.workspacePath);
      // Tool validation (review finding H10): when the directive
      // listed `tools=`, surface unknown / out-of-set names so the
      // renderer can show "rejected — unknown tool" chips and the
      // orchestrator's harness sees the typo via the matching
      // `phase` event below. The detailed variant returns the
      // resolved `allowed` list (used for the spec) AND a `dropped`
      // list (used purely for surfacing).
      const toolset = validateSubagentToolsetDetailed(d.tools);
      // Pass the AUTHORITATIVE allowlist to the worker so it
      // doesn't re-derive it (and so the renderer's `subagent-spawn`
      // chip row matches what actually ran). Defaulted runs (empty
      // / all-dropped) flow through with the read-only default,
      // which is exactly what `runSubAgent` would have produced
      // under the old surface.
      return {
        id: d.id,
        task: d.task,
        files: resolved,
        tools: toolset.allowed,
        missingFiles: missing,
        unknownTools: toolset.dropped,
        toolsetDefaulted: toolset.defaulted
      };
    })
  );
  if (validatedSpecs.some((s) => s.missingFiles.length > 0)) {
    log.warn('delegate file validation: dropped invented paths', {
      details: validatedSpecs
        .filter((s) => s.missingFiles.length > 0)
        .map((s) => ({ id: s.id, missing: s.missingFiles }))
    });
  }
  // Surface dropped tool names as a single `phase` event per offending
  // spec. One event per sub-agent (not per dropped tool) keeps the
  // timeline tidy when a directive lists 3+ typos. The matching
  // `subagent-spawn.unknownTools` slot below carries the same data
  // for the renderer's chip row — the phase event exists so the
  // orchestrator's NEXT iteration also sees the typo in its prompt
  // history (`phase` events flow through `priorTranscript`'s replay
  // into `messages[]` only as renderer-only signals; the model sees
  // them through `<run_state>` reads of the timeline rather than as
  // assistant memory, which is the correct boundary).
  for (const spec of validatedSpecs) {
    if (spec.unknownTools.length > 0) {
      const grantedDescription = spec.toolsetDefaulted
        ? 'defaulted to read-only'
        : `granted ${spec.tools.join(', ')}`;
      emit({
        kind: 'phase',
        id: randomUUID(),
        ts: Date.now(),
        label:
          `Sub-agent ${spec.id}: dropped unknown tool(s) ` +
          `${spec.unknownTools.join(', ')}; ${grantedDescription}.`
      });
      log.warn('subagent toolset validation: dropped unknown tools', {
        id: spec.id,
        dropped: spec.unknownTools,
        granted: spec.tools
      });
    }
  }
  // The earlier `phase` emit produced a structural divider (`Delegating
  // N sub-tasks`) ABOVE the spawn cards while the live status row
  // simultaneously rendered the SAME label at the timeline tail.
  // The double-up read as noise (visible as two near-identical lines
  // in screenshot §1). The `run-status` surface is sufficient — the
  // grouped `subagent-line` rows below already cluster the work
  // visually, and the live row's shimmer carries the in-flight
  // signal. Dropping the redundant divider; nothing in transcript
  // replay depended on it (PhaseDividerRow is informational only).
  emitRunStatus(
    emit,
    'delegating',
    `Delegating ${delegates.length} sub-task${delegates.length === 1 ? '' : 's'}…`,
    { delegates: delegates.length }
  );

  // Pull every pending checkpoint change for this conversation —
  // these are the file mutations the orchestrator's tool rounds have
  // performed so far that the user has not yet Accepted or Rejected.
  // We surface them to each spawning sub-agent as a
  // `<recent_mutations>` block so the worker doesn't try to `read` a
  // path that was renamed / deleted earlier in the same run. Best-
  // effort: any failure (disk error, stale workspace handle) returns
  // an empty list — the worker just sees no mutation block, same as
  // before.
  let recentMutations: PendingChange[] = [];
  try {
    recentMutations = await listPendingChanges(opts.conversationId, [opts.workspaceId]);
  } catch (err) {
    log.warn('listPendingChanges failed; sub-agents get no recent_mutations block', { err });
  }
  const recentMutationsCondensed = recentMutations
    .filter((m) => m.runId === opts.runId) // current run only
    .map((m) => ({
      kind: m.kind,
      filePath: m.filePath,
      additions: m.additions,
      deletions: m.deletions
    }));

  const runs = await runSubAgentPool(
    validatedSpecs.map((s) => ({
      id: s.id,
      task: s.task,
      files: s.files,
      ...(s.tools !== undefined ? { tools: s.tools } : {}),
      ...(recentMutationsCondensed.length > 0
        ? { recentMutations: recentMutationsCondensed }
        : {})
    })),
    {
      selection: opts.selection,
      providerName: opts.providerName,
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      conversationId: opts.conversationId,
      permissions: opts.permissions,
      strictApprovals: opts.strictApprovals,
      signal: opts.signal,
      concurrency: MAX_PARALLEL_SUBAGENTS,
      onSpawn: (spec) => {
        // Emit the directive's raw `tools` list verbatim so the renderer
        // is never dependent on a preceding `subagent-pending` event to
        // populate the sub-agent's tools chip row. `spec.tools` defaults
        // to `undefined` when the directive omitted the attribute —
        // surface an empty array in that case so the reducer's fallback
        // ladder (spawn-tools → pending-tools → []) kicks in cleanly.
        // Audit fix A2.
        //
        // `missingFiles` carries the model-invented paths the
        // validator dropped above so the renderer can render them
        // as disabled "not found" chips alongside the resolvable
        // ones. Empty array when every path resolved — the
        // renderer treats that as the no-op case.
        const validated = validatedSpecs.find((s) => s.id === spec.id);
        emit({
          kind: 'subagent-spawn',
          id: randomUUID(),
          ts: Date.now(),
          subagentId: spec.id,
          task: spec.task,
          files: spec.files,
          tools: spec.tools ?? [],
          missingFiles: validated?.missingFiles ?? [],
          ...(validated && validated.unknownTools.length > 0
            ? { unknownTools: validated.unknownTools }
            : {}),
          // Threaded from `opts.selection` so the renderer's
          // sub-agent row carries the orchestrator's authoritative
          // model badge after pending↔spawn reconciliation. A future
          // `<delegate model="…" />` override would land here as a
          // worker-specific selection; today the orchestrator and
          // every worker share one model.
          model: { ...opts.selection }
        });
      },
      onToolCall: (call, subagentId) => {
        // Strict attribution: the sub-agent passes its own id through the
        // pool, so concurrent rounds can't misattribute calls.
        //
        // Phase 2 — notify the run-level diff streamer that an
        // authoritative call has landed for this callId so it can
        // drop its in-flight state and the renderer can flip the
        // diff into settled style. The owning `subagentId` is
        // forwarded so the streamer can also reconcile any stale
        // `pending:${subagentId}:${index}` surrogate state that
        // was created when the worker's first delta lacked a real
        // id (mirrors the renderer reducer's `clearPartialFor`).
        opts.onToolCallSettled?.(call.id, subagentId);
        emit({
          kind: 'tool-call',
          id: randomUUID(),
          ts: Date.now(),
          call,
          subagentId
        });
      },
      onToolResult: (result, subagentId) => {
        // Strict attribution: the sub-agent passes its own id through the
        // pool, so concurrent rounds can't misattribute results.
        emit({
          kind: 'tool-result',
          id: randomUUID(),
          ts: Date.now(),
          result,
          subagentId
        });
      },
      onFileEdit: (info, subagentId) => {
        emit({
          kind: 'file-edit',
          id: randomUUID(),
          ts: Date.now(),
          runId: opts.runId,
          filePath: info.filePath,
          additions: info.additions,
          deletions: info.deletions,
          ...(info.entryId ? { entryId: info.entryId } : {}),
          subagentId
        });
      },
      onTokenUsage: (usage, subagentId) => {
        // Per-iteration usage report from a specific sub-agent.
        //
        // `assistantMsgId` is intentionally the EMPTY STRING — sub-agent
        // iterations do not produce orchestrator-level assistant turns,
        // so there is no orchestrator id to carry here. Renderers
        // aggregate purely on `subagentId` (which is unambiguous). The
        // optional `subagentTurnId` carries a fresh id so consumers
        // that want a per-iteration handle still have one without
        // overloading the `assistantMsgId` slot. See §6.2 in the audit.
        emit({
          kind: 'token-usage',
          id: randomUUID(),
          ts: Date.now(),
          assistantMsgId: '',
          usage,
          subagentId,
          subagentTurnId: randomUUID()
        });
      },
      onRunStatus: (event) => {
        // Forward worker-scoped `run-status` events through to the
        // orchestrator's emit sink. The event already carries
        // `detail.subagentId` (set by the sub-agent), so the renderer
        // can route it into the matching sub-agent trace card without
        // the orchestrator having to retag it. The `subagentId` second
        // argument is therefore unused at this layer — kept on the
        // callback so the contract matches the other strict-attribution
        // hooks (`onToolCall`, `onToolResult`).
        emit(event);
      },
      onTimelineEvent: (event) => {
        // Persistent events from the shared tool loop that aren't
        // covered by the streaming hooks — checkpoint audit rows,
        // re-delegation phase dividers, etc.
        emit(event);
      },
      // Streaming worker text + reasoning. Each iteration's
      // assistantMsgId is unique so the renderer keys per-iteration
      // accumulators on it. Audit fix §1.1.
      onTextDelta: (delta, assistantMsgId, subagentId) => {
        emit({
          kind: 'agent-text-delta',
          id: assistantMsgId,
          ts: Date.now(),
          delta,
          subagentId
        });
      },
      onTextEnd: (assistantMsgId, subagentId) => {
        emit({
          kind: 'agent-text-end',
          id: assistantMsgId,
          ts: Date.now(),
          subagentId
        });
      },
      onTextAborted: (assistantMsgId, subagentId) => {
        emit({
          kind: 'agent-text-aborted',
          id: assistantMsgId,
          ts: Date.now(),
          subagentId
        });
      },
      onReasoningDelta: (delta, assistantMsgId, subagentId) => {
        emit({
          kind: 'agent-reasoning-delta',
          id: assistantMsgId,
          ts: Date.now(),
          delta,
          subagentId
        });
      },
      onReasoningEnd: (assistantMsgId, subagentId, signature) => {
        emit({
          kind: 'agent-reasoning-end',
          id: assistantMsgId,
          ts: Date.now(),
          subagentId,
          // Phase 8 (2026): the Anthropic thinking signature, when
          // present, lands on the timeline event so transcript replay
          // can fan it back onto the matching sub-agent assistant
          // message's `reasoning_signature` slot.
          ...(signature !== undefined ? { signature } : {})
        });
      },
      // Live partial-args preview for in-flight worker tool calls. Per
      // the contract on `TimelineEvent`, the ephemeral
      // `tool-call-args-delta` event uses a surrogate
      // `pending:<subagentId>:<index>` callId until the provider sends
      // the real id; the renderer reconciles on the matching real
      // `tool-call` later.
      onToolCallArgsDelta: (snapshot, subagentId) => {
        const callId = snapshot.id ?? `pending:${subagentId}:${snapshot.index}`;
        // Phase 2 — tap the cumulative argsBuf into the run-level
        // diff streamer with the sub-agent's id so the emitted
        // `diff-stream` event lands on the matching worker
        // snapshot in the renderer's reducer.
        opts.argsDeltaTap?.(callId, snapshot.name, snapshot.argsBuf, subagentId);
        emit({
          kind: 'tool-call-args-delta',
          id: randomUUID(),
          ts: Date.now(),
          callId,
          ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
          index: snapshot.index,
          argsBuf: snapshot.argsBuf,
          subagentId
        });
      },
      onResult: (run) => {
        // T1-6: pass `partial` through as a distinct lifecycle status
        // instead of collapsing it to `done`. The worker's
        // `<status>partial</status>` is real progress that didn't fully
        // satisfy the verification criterion — the orchestrator's
        // harness now reasons about it semantically (see
        // `04-subagent-prompt.md` "Output format") and the renderer
        // surfaces it with a softer-tone badge.
        const spawnSpec = validatedSpecs.find((s) => s.id === run.id);
        const verdict = verifySubagentRun(run.output, {
          delegateFiles: spawnSpec?.files ?? [],
          toolResultCount: run.toolResults.length,
          inlinedFileCount: run.inlinedFileCount
        });
        const structuralMsg = malformedReasonFromAttrs(verdict.attrs);
        const wireStatus =
          run.status === 'success'
            ? 'done'
            : run.status === 'partial'
              ? 'partial'
              : run.status === 'aborted'
                ? 'aborted'
                : run.status === 'malformed' || verdict.structural === 'malformed'
                  ? 'malformed'
                  : 'failed';
        emit({
          kind: 'subagent-status',
          id: randomUUID(),
          ts: Date.now(),
          subagentId: run.id,
          status: wireStatus,
          ...((run.error ?? structuralMsg)
            ? { message: run.error ?? structuralMsg }
            : {})
        });
        // T0-3: skip the `subagent-result` emission when the worker
        // aborted. An aborted worker carries `output: ''`, so the
        // event would persist an empty `<result>...` envelope into
        // the JSONL and force the renderer reducer to filter it on
        // every replay. The matching `subagent-status` (with
        // `status: 'aborted'`) already conveys the outcome; the
        // result row is purely a transcript artefact and skipping
        // it on abort keeps replays + the renderer's
        // empty-state branch honest.
        if (run.status === 'aborted') return;
        // Persist ONLY the `<result>...</result>` envelope, not the
        // worker's preceding chain-of-thought / scratch text. The
        // verifier already extracts the inner body cleanly; we
        // re-wrap and emit that as the canonical `subagent-result`
        // body so JSONL transcripts and replay envelopes don't
        // accumulate the worker's full ramble. Audit fix §1.7.
        //
        // When parsing fails (no `<result>` tag at all), we fall
        // back to the raw output so `SubAgentResult` can still
        // surface SOMETHING — the renderer's empty-state path then
        // explains the absence with a friendly hint. The worker's
        // own status (set on `subagent-status`) already records the
        // failure reason; this is just transcript hygiene.
        const parsed = parseResultEnvelope(run.output);
        const persistedOutput = parsed.found
          ? `<result>${parsed.inner}</result>`
          : run.output;
        emit({
          kind: 'subagent-result',
          id: randomUUID(),
          ts: Date.now(),
          subagentId: run.id,
          output: persistedOutput
        });
      }
    }
  );

  // Build the verified envelope to inject back into the orchestrator.
  emitRunStatus(emit, 'verifying', 'Verifying sub-agent output…', {
    delegates: runs.length
  });
  const specsById = new Map(
    validatedSpecs.map((s) => [s.id, { task: s.task, files: s.files }])
  );
  const verified = runs.map((run) => {
    const spec = specsById.get(run.id);
    const verdict = verifySubagentRun(run.output, {
      delegateFiles: spec?.files ?? [],
      toolResultCount: run.toolResults.length,
      inlinedFileCount: run.inlinedFileCount
    });
    return {
      id: run.id,
      status: run.status,
      attrs: verdict.attrs,
      inner: verdict.inner,
      structural: verdict.structural
    };
  });

  const countable = verified.filter((v) => v.status !== 'aborted');
  const allBad =
    countable.length > 0 &&
    countable.every(
      (v) => v.structural === 'self-failed' || v.structural === 'malformed'
    );
  if (allBad) {
    counters.consecutiveBadRounds += 1;
  } else {
    counters.consecutiveBadRounds = 0;
  }

  // Per-task strike accounting. A task that fails three rounds in a
  // row is surfaced as a soft signal even when the round-level
  // `allBad` counter never trips (because of successful siblings).
  // The map is updated AFTER the round-level reset so the two
  // counters stay independent.
  //
  // We resolve each verified id back to its originating spec via
  // `validatedSpecs` (already keyed by id at spawn time) so the
  // signature uses the post-validation files list — same shape the
  // worker actually saw.
  const newlyEscalated: Array<{ key: string; streak: number; ids: string[] }> = [];
  // Track which signatures saw at least one OK verdict in THIS round
  // so a mixed-signature spec (rare but possible if the model reuses
  // the same task description) clears the streak deterministically.
  const okSignaturesThisRound = new Set<string>();
  for (const v of countable) {
    const spec = specsById.get(v.id);
    if (!spec) continue;
    if (v.structural === 'ok') {
      okSignaturesThisRound.add(taskSignature(spec.task, spec.files));
    }
  }
  // Map of signature → ids attributed in THIS round (for the
  // escalation surface).
  const idsBySignatureThisRound = new Map<string, string[]>();
  for (const v of countable) {
    const spec = specsById.get(v.id);
    if (!spec) continue;
    const key = taskSignature(spec.task, spec.files);
    if (v.structural === 'ok' || okSignaturesThisRound.has(key)) {
      counters.perTaskBadStreak.delete(key);
      continue;
    }
    const next = (counters.perTaskBadStreak.get(key) ?? 0) + 1;
    counters.perTaskBadStreak.set(key, next);
    const bucket = idsBySignatureThisRound.get(key) ?? [];
    bucket.push(v.id);
    idsBySignatureThisRound.set(key, bucket);
    if (next >= MAX_PER_TASK_BAD_STREAK) {
      newlyEscalated.push({ key, streak: next, ids: bucket });
    }
  }
  if (newlyEscalated.length > 0) {
    log.warn('per-task bad streak escalation', {
      escalations: newlyEscalated.map((e) => ({
        key: e.key.slice(0, 120),
        streak: e.streak,
        ids: e.ids
      }))
    });
    // T1-7: coalesce phase events when more than two tasks escalate
    // in the same round. A round of 8 sub-agents all hitting the
    // threshold used to spam 8 near-identical timeline rows; the
    // batched form below keeps single-task escalation verbose
    // (most common case) but degrades gracefully on burst rounds.
    if (newlyEscalated.length <= 2) {
      // 1- or 2-task escalation — keep the per-task verbose form so
      // the user gets the streak count + signature head per task.
      for (const e of newlyEscalated) {
        const display = e.key.split('|')[0]!.slice(0, 80);
        emit({
          kind: 'phase',
          id: randomUUID(),
          ts: Date.now(),
          label:
            `Task failing ${e.streak} rounds in a row — pivot decomposition: ${display}`
        });
      }
    } else {
      // 3+ tasks escalating in one round — one summary row with
      // the count and the highest streak, plus a comma-joined
      // signature head list. The structured log above has the
      // full data for triage.
      const maxStreak = newlyEscalated.reduce((m, e) => Math.max(m, e.streak), 0);
      const heads = newlyEscalated
        .map((e) => e.key.split('|')[0]!.slice(0, 40))
        .join(', ');
      emit({
        kind: 'phase',
        id: randomUUID(),
        ts: Date.now(),
        label:
          `${newlyEscalated.length} tasks failing (max ${maxStreak} rounds) — ` +
          `pivot decomposition: ${heads}`
      });
    }
  }

  // Push the verified `<subagent_results>` envelope into the
  // orchestrator's message history BEFORE the halt branch so the
  // failing-round verdicts are persisted into replay even on
  // escalation. Earlier behavior emitted the `error` event and
  // returned `'halt'` while skipping the envelope push, leaving the
  // model's reconstructed history with raw spawn/status/result
  // events but no synthesized verifier verdict for the failing
  // round — a small but real fidelity gap. The verdicts go in for
  // every outcome (continue / halt), and the halt-vs-continue
  // decision is made strictly afterward.
  const hostLines = await verifyDelegateArtifacts(
    validatedSpecs.map((s) => ({ id: s.id, task: s.task, files: s.files })),
    opts.workspacePath
  );
  const hostXml = formatHostVerificationXml(hostLines);
  let resultsBody = buildSubagentResultsEnvelope(
    verified.map((v) => ({ id: v.id, attrs: v.attrs, inner: v.inner }))
  );
  if (hostXml.length > 0) {
    resultsBody = resultsBody.replace(
      '</subagent_results>',
      `\n${hostXml}\n</subagent_results>`
    );
  }
  messages.push({
    role: 'user',
    content: resultsBody
  });
  if (counters.consecutiveBadRounds >= MAX_DELEGATION_BAD_ROUNDS) {
    log.warn('delegation three-strike halt', {
      consecutiveBadRounds: counters.consecutiveBadRounds,
      verified: verified.map((v) => ({ id: v.id, structural: v.structural }))
    });
    // Pre-halt verdict summary (review finding B2). Without this row,
    // the user sees only the bare `error` event and has to expand every
    // SubAgentTrace card to triage WHICH workers failed. We emit a
    // single `phase` event listing the structural verdict per sub-agent
    // id from this round so the timeline carries a one-line cause
    // narrative right next to the halt error.
    const verdictSummary = verified
      .map((v) => `${v.id}=${v.structural}`)
      .join(', ');
    emit({
      kind: 'phase',
      id: randomUUID(),
      ts: Date.now(),
      label:
        `Three-strike halt — last round verdicts: ${verdictSummary}`
    });
    emit({
      kind: 'error',
      id: randomUUID(),
      ts: Date.now(),
      message:
        `${MAX_DELEGATION_BAD_ROUNDS} consecutive sub-agent rounds failed verification — escalating to user.`
    });
    return 'halt';
  }

  log.info('delegation round finished', {
    count: delegates.length,
    verdicts: verified.map((v) => ({ id: v.id, structural: v.structural })),
    consecutiveBadRounds: counters.consecutiveBadRounds,
    ms: Date.now() - startedAt
  });
  return 'continue';
}

/**
 * Sentinel placeholder appended to `missing[]` when the delegate's
 * `files=` list exceeded `MAX_FILES_PER_DELEGATE` (review finding H4).
 * The renderer's `subagent-spawn` chip surface treats every entry in
 * `missing[]` identically — a small dimmed chip with a tooltip — so a
 * synthetic path here is the cheapest way to surface the truncation
 * without changing the wire shape. The leading angle-bracket
 * guarantees the placeholder can never collide with a real workspace-
 * relative path on any platform.
 */
const FILE_LIST_CAP_PLACEHOLDER = '<file-list cap exceeded>';

/**
 * Concurrency cap on parallel `fs.access` probes inside `classifyFiles`
 * (review finding H4). Without this cap, a 32-file directive triggers
 * 32 parallel probes against the FS layer; tuning to 8 matches the
 * `MAX_PARALLEL_SUBAGENTS` ceiling and keeps the I/O budget aligned
 * with the swarm itself. The cap is internal — exported only for
 * the regression test that asserts no more than `N` probes overlap.
 */
export const CLASSIFY_FILES_CONCURRENCY = 8;

/**
 * Split a delegate's `files[]` into the paths that resolve against the
 * active workspace (`resolved`) and the ones that don't (`missing`).
 * Used by `handleDelegates` to (a) hand the worker only the real
 * paths, and (b) surface the invented ones to the renderer so the
 * user sees the model's miss as a marked chip rather than a silent
 * drop.
 *
 * Resolution rules:
 *   - Empty / non-string entries land in `missing` (defensive — the
 *     parser should already filter these but a future change to the
 *     directive grammar shouldn't smuggle a typed-as-empty path into
 *     the worker).
 *   - Absolute paths must reside INSIDE the workspace root. An
 *     absolute path outside the sandbox is treated as missing — the
 *     read tool would refuse it anyway, and surfacing the path
 *     untouched in the chip UI would mislead the user into thinking
 *     it was usable.
 *   - Relative paths are resolved against the workspace root and
 *     fed to `fs.access`. Any error (ENOENT, EACCES, …) lands the
 *     path in `missing`.
 *
 * Order is preserved within each bucket so the rendered chip order
 * matches the directive's literal order. Pure / no-throw — every
 * branch returns a structured value the caller can rely on.
 *
 * Caps (review finding H4):
 *   - File-list length is capped at `MAX_FILES_PER_DELEGATE`. Excess
 *     entries land in `missing` with the `<file-list cap exceeded>`
 *     placeholder so the user / renderer sees the truncation; the
 *     model's actual paths beyond the cap are dropped (the harness
 *     forbids long lists; over-cap input is a bug or pathological
 *     turn either way).
 *   - The probe Promise.all is bounded to `CLASSIFY_FILES_CONCURRENCY`
 *     parallel `fs.access` calls. Cap is enforced via a tiny
 *     index-stepper pool (no third-party dep). Result order is
 *     preserved by writing each probe's outcome into a pre-sized
 *     slot and then partitioning at the end.
 *
 * Exported for the dedicated unit tests that pin the path-prefix
 * sandbox boundary (review finding H1) and the cap + concurrency
 * contract (review finding H4). Treat as an internal helper for
 * production callers — only `handleDelegates` invokes it.
 */
export async function classifyFiles(
  files: ReadonlyArray<string>,
  workspacePath: string
): Promise<{ resolved: string[]; missing: string[] }> {
  // Dedupe by trimmed string (review finding M9). The directive
  // parser doesn't reject duplicates — a `<delegate files="A,A,A" />`
  // would otherwise probe `A` three times and inline its body three
  // times in the worker's `<files>` block, wasting tokens. We
  // preserve first-seen order via a Set so the renderer's chip row
  // and the worker's prompt see the same logical sequence.
  //
  // Whitespace-only / empty entries are NOT folded together here —
  // each empty raw entry stays distinct so the inner pool can
  // surface each as its own `missing` bucket entry. The dedupe is
  // ONLY between equal trimmed real strings.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of files) {
    if (typeof raw !== 'string') {
      // Defensive — non-string entries land in `missing` via the
      // pool below. Pass through verbatim so the slot count matches.
      deduped.push(raw as string);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      // Each empty entry is structurally distinct — pass through.
      deduped.push(raw);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(raw);
  }
  // Cap the input length BEFORE any FS work so a thousand-path
  // directive cannot spike the I/O budget even with concurrency
  // throttling — the throttle bounds parallelism, the cap bounds
  // total work.
  const overflow = deduped.length > MAX_FILES_PER_DELEGATE
    ? deduped.slice(MAX_FILES_PER_DELEGATE)
    : [];
  const accepted = deduped.length > MAX_FILES_PER_DELEGATE
    ? deduped.slice(0, MAX_FILES_PER_DELEGATE)
    : deduped;

  // Pre-sized slot per accepted entry so we can preserve directive
  // order regardless of the order in which probes settle. Each slot
  // ends as exactly one of:
  //   { kind: 'resolved'; trimmed: string }
  //   { kind: 'missing';  raw: string }
  type Slot =
    | { kind: 'resolved'; trimmed: string }
    | { kind: 'missing'; raw: string };
  const slots = new Array<Slot>(accepted.length);

  // Bounded-concurrency probe pool. A simple shared-cursor design:
  // each worker pulls the next index, runs the probe, writes the
  // slot, repeats. Workers exit when the cursor is past the end.
  // The pool size is `min(concurrency, accepted.length)` so we
  // don't spin extra idle workers on tiny inputs.
  //
  // Workspace-root canonicalization (review finding M8). The legacy
  // code used a lexical `resolvePath(workspacePath)` for the
  // containment check below. If the workspace path is itself a
  // symlink (`~/code/project → /Volumes/Foo/project` — common Mac
  // setup with external drives, or a Linux user using a `~/work`
  // symlink to a SSD mount), the lexical resolution returned the
  // pre-symlink path. The candidate file's `abs` was then
  // realpath'd (or absolute-passed-through) and `relative()`
  // returned a `..`-prefixed string — every legitimate file appeared
  // to escape the sandbox.
  //
  // Falling back to the lexical resolve when `realpath` fails
  // (ENOENT, EACCES) keeps the function usable in tests that pass
  // synthetic paths that don't exist on disk; the containment check
  // then matches what the legacy code did.
  let wsRoot: string;
  try {
    wsRoot = await realpath(workspacePath);
  } catch {
    wsRoot = resolvePath(workspacePath);
  }
  let cursor = 0;
  const probe = async (): Promise<void> => {
    while (cursor < accepted.length) {
      const i = cursor++;
      const raw = accepted[i] as string | undefined;
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        slots[i] = { kind: 'missing', raw: typeof raw === 'string' ? raw : String(raw) };
        continue;
      }
      const trimmed = raw.trim();
      // Resolve relative paths against the canonical workspace root
      // (review finding M8) so a symlinked workspace doesn't make
      // every file appear to escape the sandbox. Absolute candidates
      // pass through unchanged — they undergo the same `relative`
      // check against the canonical root below.
      const abs = isAbsolute(trimmed)
        ? trimmed
        : resolvePath(wsRoot, trimmed);
      // Canonicalize the candidate path before containment. When the
      // workspace root was `realpath`'d but the delegate supplied an
      // absolute path through a junction/symlink spelling
      // (`<link>/file` vs `<target>/file`), a lexical `relative()`
      // falsely reports escape. Fall back to lexical `abs` on ENOENT
      // so not-yet-created paths still reach `access`.
      let probeAbs = abs;
      try {
        probeAbs = await realpath(abs);
      } catch {
        /* keep lexical abs */
      }
      const rel = relativePath(wsRoot, probeAbs);
      if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
        // Sandbox escape (literal `..`-prefix or cross-drive on
        // Windows) — see review finding H1.
        slots[i] = { kind: 'missing', raw: trimmed };
        continue;
      }
      try {
        await access(probeAbs);
        slots[i] = { kind: 'resolved', trimmed };
      } catch {
        slots[i] = { kind: 'missing', raw: trimmed };
      }
    }
  };
  const workerCount = Math.min(CLASSIFY_FILES_CONCURRENCY, accepted.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) workers.push(probe());
  await Promise.all(workers);

  const resolved: string[] = [];
  const missing: string[] = [];
  for (const slot of slots) {
    if (!slot) continue; // unreachable — every index is filled by a worker
    if (slot.kind === 'resolved') resolved.push(slot.trimmed);
    else missing.push(slot.raw);
  }
  // Surface the cap-exceeded overflow as a single sentinel chip so
  // the user sees "the model asked for N more paths; we ignored
  // them" without polluting `missing[]` with N entries that all
  // mean the same thing. The placeholder is structurally distinct
  // from any real workspace path (leading `<`).
  if (overflow.length > 0) {
    missing.push(FILE_LIST_CAP_PLACEHOLDER);
  }
  return { resolved, missing };
}
