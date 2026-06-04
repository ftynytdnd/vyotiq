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
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_FILES_PER_DELEGATE,
  MAX_PER_TASK_BAD_STREAK
} from '@shared/constants.js';
import {
  formatDelegateSpawnStatusLabel,
  resolveDelegateRoundConcurrency
} from '../delegateConcurrency.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';
import type { ArgsDeltaTap } from './handleAssistantTurn.js';
import { validateSubagentToolsetDetailed } from '../../tools/policy/index.js';
import { malformedReasonFromAttrs } from '../malformedReason.js';
import {
  verifyDelegateArtifacts,
  formatHostVerificationXml
} from '../verifyDelegateArtifacts.js';
import { getRunManifest } from '../../checkpoints/index.js';
import type { CheckpointChangeKind } from '@shared/types/checkpoint.js';

const log = logger.child('orch/delegates');

const RECENT_MUTATIONS_CAP = 50;

function recentMutationsFromManifest(
  entries: ReadonlyArray<{
    kind: CheckpointChangeKind;
    filePath: string;
    additions: number;
    deletions: number;
    ts: number;
  }>
): Array<{
  kind: CheckpointChangeKind;
  filePath: string;
  additions: number;
  deletions: number;
}> {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  return sorted.slice(-RECENT_MUTATIONS_CAP).map((e) => ({
    kind: e.kind,
    filePath: e.filePath,
    additions: e.additions,
    deletions: e.deletions
  }));
}

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
  signal: AbortSignal;
  /** Parent worker id when this round is nested one level deep. */
  parentSubagentId?: string;
  /** Groups workers from the same orchestrator turn for concurrent UI. */
  delegationBatchId?: string;
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
  if (delegates.length === 0) {
    return 'continue';
  }

  let recentMutations: ReturnType<typeof recentMutationsFromManifest> = [];
  try {
    const manifest = await getRunManifest(opts.workspaceId, opts.runId);
    if (manifest?.entries?.length) {
      recentMutations = recentMutationsFromManifest(manifest.entries);
    }
  } catch {
    /* best-effort — workers spawn without mutation hints */
  }

  const startedAt = Date.now();
  log.info('delegation round starting', {
    count: delegates.length,
    ids: delegates.map((d) => d.id),
    modelId: opts.selection.modelId
  });
  // Validate each delegate's `files` against the workspace before spawn.
  let classifyWsRoot: string;
  try {
    classifyWsRoot = await realpath(opts.workspacePath);
  } catch {
    classifyWsRoot = resolvePath(opts.workspacePath);
  }
  const validatedSpecs = await Promise.all(
    delegates.map(async (d) => {
      const { resolved, missing } = await classifyFiles(
        d.files,
        opts.workspacePath,
        classifyWsRoot
      );
      const requestedPaths = d.files.filter(
        (f): f is string => typeof f === 'string' && f.trim().length > 0
      );
      const skipSpawnAllInvented = requestedPaths.length > 0 && resolved.length === 0;
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
        toolsetDefaulted: toolset.defaulted,
        skipSpawnAllInvented
      };
    })
  );
  const validatedById = new Map(validatedSpecs.map((s) => [s.id, s]));
  const spawnSpecs = validatedSpecs.filter((s) => !s.skipSpawnAllInvented);
  const skippedAllInvented = validatedSpecs.filter((s) => s.skipSpawnAllInvented);
  // Invented-file skips are logged (not surfaced as a timeline `phase`
  // row): the model already learns the spawn didn't happen via the
  // round's `<subagent_results>` / `<run_state>`, and the row was pure
  // clutter. Diagnostic detail stays in the structured log.
  for (const spec of skippedAllInvented) {
    log.warn('delegate file validation: skipped spawn (all paths invented)', {
      id: spec.id,
      missing: spec.missingFiles
    });
  }
  if (validatedSpecs.some((s) => s.missingFiles.length > 0)) {
    log.warn('delegate file validation: dropped invented paths', {
      details: validatedSpecs
        .filter((s) => s.missingFiles.length > 0)
        .map((s) => ({ id: s.id, missing: s.missingFiles }))
    });
  }
  // Dropped unknown tool names are logged only (no timeline `phase`
  // row). The granted toolset is already visible to the model in the
  // spawned worker's behavior; the row added noise on every typo.
  for (const spec of validatedSpecs) {
    if (spec.unknownTools.length > 0) {
      log.warn('subagent toolset validation: dropped unknown tools', {
        id: spec.id,
        dropped: spec.unknownTools,
        granted: spec.tools,
        defaulted: spec.toolsetDefaulted
      });
    }
  }
  // The earlier `phase` emit produced a structural divider (`Spawning
  // N workers`) ABOVE the spawn cards while the live status row
  // simultaneously rendered the SAME label at the timeline tail.
  // The double-up read as noise (visible as two near-identical lines
  // in screenshot §1). The `run-status` surface is sufficient — the
  // grouped `subagent-line` rows below already cluster the work
  // visually, and the live row's shimmer carries the in-flight
  // signal. Dropping the redundant divider; nothing in transcript
  // replay depended on it (PhaseDividerRow is informational only).
  let providerMaxConcurrent: number | undefined;
  try {
    const prov = await getProviderWithKey(opts.selection.providerId);
    providerMaxConcurrent = prov?.maxConcurrentStreams;
  } catch {
    /* best-effort — clamp uses host ceiling only */
  }
  const spawnIds = new Set(spawnSpecs.map((s) => s.id));
  const poolConcurrency = resolveDelegateRoundConcurrency(
    delegates.filter((d) => spawnIds.has(d.id)),
    providerMaxConcurrent
  );
  const delegationBatchId = opts.delegationBatchId ?? randomUUID();
  let poolSpawned = 0;

  const emitDelegationProgress = (): void => {
    const waiting = Math.max(0, spawnSpecs.length - poolSpawned);
    emitRunStatus(
      emit,
      'delegating',
      formatDelegateSpawnStatusLabel(spawnSpecs.length, poolConcurrency),
      {
        delegates: spawnSpecs.length,
        inFlightMax: poolConcurrency,
        ...(waiting > 0 ? { queued: waiting } : {})
      }
    );
  };

  emitDelegationProgress();

  // Pending for every spec (batch accounting); `queued: true` until
  // `onSpawn` so the renderer shows counts in DelegationBatchSummary
  // and per-sub-agent cards only once active (pending/running).
  for (const spec of spawnSpecs) {
    emit({
      kind: 'subagent-pending',
      id: randomUUID(),
      ts: Date.now(),
      subagentId: spec.id,
      task: spec.task,
      files: spec.files,
      tools: spec.tools ?? [],
      queued: true,
      delegationBatchId,
      model: { ...opts.selection },
      ...(opts.parentSubagentId ? { parentSubagentId: opts.parentSubagentId } : {})
    });
  }
  const incrementalResultIndices: number[] = [];
  const verdictByRunId = new Map<
    string,
    ReturnType<typeof verifySubagentRun>
  >();
  log.info('delegation pool parallelism', {
    specs: spawnSpecs.length,
    concurrency: poolConcurrency,
    queued: Math.max(0, spawnSpecs.length - poolConcurrency),
    inFlightMax: poolConcurrency,
    providerMaxConcurrent,
    delegationBatchId
  });

  const runs =
    spawnSpecs.length === 0
      ? []
      : await runSubAgentPool(
    spawnSpecs.map((s) => ({
      id: s.id,
      task: s.task,
      files: s.files,
      ...(s.tools !== undefined ? { tools: s.tools } : {}),
      ...(recentMutations.length > 0 ? { recentMutations } : {})
    })),
    {
      selection: opts.selection,
      providerName: opts.providerName,
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      conversationId: opts.conversationId,
      permissions: opts.permissions,
      signal: opts.signal,
      concurrency: poolConcurrency,
      onSpawn: (spec) => {
        poolSpawned += 1;
        emitDelegationProgress();
        const validated = validatedById.get(spec.id);
        emit({
          kind: 'subagent-spawn',
          id: randomUUID(),
          ts: Date.now(),
          subagentId: spec.id,
          task: spec.task,
          files: spec.files,
          tools: spec.tools ?? [],
          missingFiles: validated?.missingFiles ?? [],
          delegationBatchId,
          ...(opts.parentSubagentId ? { parentSubagentId: opts.parentSubagentId } : {}),
          ...(validated && validated.unknownTools.length > 0
            ? { unknownTools: validated.unknownTools }
            : {}),
          // Threaded from `opts.selection` so the renderer's
          // sub-agent row carries the orchestrator's authoritative
          // model badge after pending↔spawn reconciliation. A future
          // A per-worker `model` field on the `delegate` tool args
          // would land here as a worker-specific selection; today the orchestrator and
          // every worker share one model.
          model: { ...opts.selection }
        });
      },
      onToolCall: (call, subagentId) => {
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
        emit(event);
      },
      onTimelineEvent: (event) => {
        emit(event);
      },
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
          ...(signature !== undefined ? { signature } : {})
        });
      },
      onToolCallArgsDelta: (snapshot, subagentId) => {
        const callId = snapshot.id ?? `pending:${subagentId}:${snapshot.index}`;
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
        const spawnSpec = validatedById.get(run.id);
        const verdict = verifySubagentRun(run.output, {
          delegateFiles: spawnSpec?.files ?? [],
          toolResultCount: run.toolResults.length,
          inlinedFileCount: run.inlinedFileCount
        });
        verdictByRunId.set(run.id, verdict);
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
          structuralVerdict: verdict.structural,
          ...((run.error ?? structuralMsg)
            ? { message: run.error ?? structuralMsg }
            : {})
        });
        if (run.status === 'aborted') return;
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
        const ctxStatus =
          run.status === 'success'
            ? 'success'
            : run.status === 'partial'
              ? 'partial'
              : run.status === 'failed'
                ? 'failed'
                : verdict.structural === 'malformed'
                  ? 'malformed'
                  : 'failed';
        messages.push({
          role: 'user',
          content:
            `<subagent_result id="${run.id}" status="${ctxStatus}" partial="true">\n` +
            `${persistedOutput}\n</subagent_result>`
        });
        incrementalResultIndices.push(messages.length - 1);
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
  const verifiedFromRuns = runs.map((run) => {
    const spec = specsById.get(run.id);
    const verdict =
      verdictByRunId.get(run.id) ??
      verifySubagentRun(run.output, {
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
  const skippedVerified = skippedAllInvented.map((spec) => {
    const invented = spec.missingFiles.filter((p) => !p.startsWith('<'));
    const pathsNote =
      invented.length > 0 ? ` Invented: ${invented.join(', ')}.` : '';
    return {
      id: spec.id,
      status: 'failed' as const,
      attrs: {
        status: 'failed',
        malformed: 'true',
        reason: 'invented-files'
      },
      inner:
        'Host skipped spawn: every files= path was invented and none resolve ' +
        'in the workspace. Run `ls` via a real tool call, then re-delegate ' +
        'with paths from workspace_context or ls output only.' +
        pathsNote,
      structural: 'malformed' as const
    };
  });
  const verified = [...verifiedFromRuns, ...skippedVerified];

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
    // Per-task escalation is logged only. The model already adapts via
    // `<run_state>` (`failing_tasks` / `consecutive_bad_delegation`) and
    // the round's `<subagent_results>`; surfacing one timeline `phase`
    // row per escalating task was a major clutter source on burst rounds.
    log.warn('per-task bad streak escalation', {
      escalations: newlyEscalated.map((e) => ({
        key: e.key.slice(0, 120),
        streak: e.streak,
        ids: e.ids
      }))
    });
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
    spawnSpecs.map((s) => ({ id: s.id, task: s.task, files: s.files })),
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
  // Phase 4b — drop per-worker partial slices superseded by the final
  // verified envelope so the orchestrator does not see duplicate bodies.
  if (incrementalResultIndices.length > 0) {
    for (const i of [...incrementalResultIndices].sort((a, b) => b - a)) {
      messages.splice(i, 1);
    }
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
    // Single terminal `error` row (the separate per-verdict `phase`
    // divider was dropped as part of the phase-row declutter). The
    // per-task verdict summary that the divider used to carry (review
    // finding B2 — "which tasks failed, and how") is folded INTO this
    // row so the diagnostic value survives without a redundant second
    // event: the user still sees cause (which ids / structural
    // verdicts) and effect (the escalation) in one line.
    const verdictSummary = verified
      .map((v) => `${v.id}=${v.structural}`)
      .join(', ');
    emit({
      kind: 'error',
      id: randomUUID(),
      ts: Date.now(),
      message:
        `${MAX_DELEGATION_BAD_ROUNDS} consecutive sub-agent rounds failed verification` +
        (verdictSummary.length > 0 ? ` (${verdictSummary})` : '') +
        ` — escalating to user.`
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

/** Placeholder in `missing[]` when `files=` exceeded `MAX_FILES_PER_DELEGATE`. */
const FILE_LIST_CAP_PLACEHOLDER = '<file-list cap exceeded>';

/** Max parallel `fs.access` probes per `classifyFiles` invocation. */
export const CLASSIFY_FILES_CONCURRENCY = 8;

/**
 * Split delegate `files[]` into workspace-resolvable paths vs missing.
 * Exported for unit tests; production callers should pass `wsRoot` when
 * classifying many delegates in one round.
 */
export async function classifyFiles(
  files: ReadonlyArray<string>,
  workspacePath: string,
  cachedWorkspaceRoot?: string
): Promise<{ resolved: string[]; missing: string[] }> {
  // Dedupe equal trimmed paths; preserve first-seen order.
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
  let wsRoot: string;
  if (cachedWorkspaceRoot !== undefined) {
    wsRoot = cachedWorkspaceRoot;
  } else {
    try {
      wsRoot = await realpath(workspacePath);
    } catch {
      wsRoot = resolvePath(workspacePath);
    }
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
      const abs = isAbsolute(trimmed)
        ? trimmed
        : resolvePath(wsRoot, trimmed);
      let probeAbs = abs;
      try {
        probeAbs = await realpath(abs);
      } catch {
        /* keep lexical abs */
      }
      const rel = relativePath(wsRoot, probeAbs);
      if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
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
