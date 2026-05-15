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
import { access } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve as resolvePath } from 'node:path';
import type {
  ChatMessage,
  ChatPermissions,
  TimelineEvent
} from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { ParsedDelegate } from '../envelope/index.js';
import { runSubAgentPool } from '../SubAgentPool.js';
import { verifySubagentOutput } from '../verifier.js';
import { buildSubagentResultsEnvelope } from '../envelope/index.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_PARALLEL_SUBAGENTS
} from '@shared/constants.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';
import type { ArgsDeltaTap } from './handleAssistantTurn.js';

const log = logger.child('orch/delegates');

export interface DelegationCounters {
  /** Number of consecutive delegation rounds that ended in total failure. */
  consecutiveBadRounds: number;
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
      return {
        id: d.id,
        task: d.task,
        files: resolved,
        ...(d.tools !== undefined ? { tools: d.tools } : {}),
        missingFiles: missing
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

  const runs = await runSubAgentPool(
    validatedSpecs.map((s) => ({
      id: s.id,
      task: s.task,
      files: s.files,
      ...(s.tools !== undefined ? { tools: s.tools } : {})
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
          ...(validated && validated.missingFiles.length > 0
            ? { missingFiles: validated.missingFiles }
            : {})
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
      onReasoningEnd: (assistantMsgId, subagentId) => {
        emit({
          kind: 'agent-reasoning-end',
          id: assistantMsgId,
          ts: Date.now(),
          subagentId
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
        emit({
          kind: 'subagent-status',
          id: randomUUID(),
          ts: Date.now(),
          subagentId: run.id,
          status:
            run.status === 'success' || run.status === 'partial'
              ? 'done'
              : run.status === 'aborted'
                ? 'aborted'
                : 'failed',
          ...(run.error ? { message: run.error } : {})
        });
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
  const verified = runs.map((run) => {
    const verdict = verifySubagentOutput(run.output);
    return { id: run.id, attrs: verdict.attrs, inner: verdict.inner, structural: verdict.structural };
  });

  const allBad = verified.length > 0 && verified.every(
    (v) => v.structural === 'self-failed' || v.structural === 'malformed'
  );
  if (allBad) {
    counters.consecutiveBadRounds += 1;
  } else {
    counters.consecutiveBadRounds = 0;
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
  messages.push({
    role: 'user',
    content: buildSubagentResultsEnvelope(
      verified.map((v) => ({ id: v.id, attrs: v.attrs, inner: v.inner }))
    )
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
 * Exported for the dedicated unit test that pins the path-prefix
 * sandbox boundary (review finding H1). Treat as an internal helper
 * for production callers — only `handleDelegates` invokes it.
 */
export async function classifyFiles(
  files: ReadonlyArray<string>,
  workspacePath: string
): Promise<{ resolved: string[]; missing: string[] }> {
  const resolved: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    files.map(async (raw) => {
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        missing.push(typeof raw === 'string' ? raw : String(raw));
        return;
      }
      const trimmed = raw.trim();
      // Reject absolute paths that escape the sandbox before touching
      // the disk — `path.resolve` would otherwise happily traverse
      // upward and `fs.access` would either succeed (leaking out-of-
      // scope state into the worker) or fail with a generic ENOENT
      // that hides the policy violation.
      //
      // Containment check uses `path.relative` rather than the prior
      // `abs.startsWith(wsRoot)`: a literal prefix match treats a
      // sibling directory whose name shares a workspace's prefix
      // (`/projects/foo` vs `/projects/foobar/...`) as "inside" the
      // sandbox. `relative()` returns an `..`-prefixed string when
      // the target escapes the root, regardless of name overlap.
      // Review finding H1.
      const abs = isAbsolute(trimmed)
        ? trimmed
        : resolvePath(workspacePath, trimmed);
      const wsRoot = resolvePath(workspacePath);
      const rel = relativePath(wsRoot, abs);
      if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
        // `rel === ''` means the path resolved to the workspace root
        // itself — useless as a "file" attachment, treat as missing.
        // `..`-prefix is a sandbox escape. An `isAbsolute(rel)` result
        // happens on Windows when `abs` lives on a different drive
        // than `wsRoot`; same escape semantics.
        missing.push(trimmed);
        return;
      }
      try {
        await access(abs);
        resolved.push(trimmed);
      } catch {
        missing.push(trimmed);
      }
    })
  );
  return { resolved, missing };
}
