/**
 * SubAgentPool — runs spec'd sub-agents concurrently with a bounded
 * parallelism cap. Streams telemetry callbacks per sub-agent so the
 * orchestrator can mirror them to the UI as a live swarm trace.
 *
 * Every `runSubAgent` call is wrapped in a try/catch so a thrown
 * exception (bad harness, IPC teardown mid-call, provider classification
 * error) can never reject `Promise.all` — the pool always resolves with
 * one `SubAgentRun` per spec. Thrown errors are converted into a
 * `{ status: 'failed', error }` shape the verifier already knows how to
 * handle, so the three-strike delegation path keeps working.
 */

import type { SubAgentDeps, SubAgentRun, SubAgentSpec } from './SubAgent.js';
import { runSubAgent } from './SubAgent.js';
import { createInlineFileCache } from './contextManager.js';
import { MAX_PARALLEL_SUBAGENTS } from '@shared/constants.js';
import { logger } from '../logging/logger.js';
import { isAbortError } from './abortSignal.js';

const log = logger.child('orchestrator/pool');

export interface PoolDeps extends SubAgentDeps {
  /** Optional concurrency cap. Defaults to MAX_PARALLEL_SUBAGENTS. */
  concurrency?: number;
  /** Per-sub-agent spawn callback (for UI updates). */
  onSpawn?: (spec: SubAgentSpec) => void;
  onResult?: (run: SubAgentRun) => void;
}

/**
 * Executes ALL specs and returns when every one has settled. Honors the
 * concurrency cap; preserves order in the result array.
 */
export async function runSubAgentPool(specs: SubAgentSpec[], deps: PoolDeps): Promise<SubAgentRun[]> {
  const limit = Math.max(1, deps.concurrency ?? MAX_PARALLEL_SUBAGENTS);
  const results: SubAgentRun[] = new Array(specs.length);
  let idx = 0;
  // Audit fix A2: one round-scoped inlining cache shared across every
  // worker in this pool invocation. The orchestrator routinely
  // delegates the same file set to multiple workers in one round
  // (verified in screenshot 1 — `core/agent.py`, `core/state.py`
  // appeared on three concurrent specs); pre-fix every worker
  // re-resolved real paths and re-read identical bytes from disk.
  // Caller-overridable so a future caller that pre-warms the cache
  // (e.g. a planner) can hand its own Map in via `deps.inlineCache`.
  const sharedInlineCache = deps.inlineCache ?? createInlineFileCache();

  async function worker(): Promise<void> {
    while (true) {
      if (deps.signal.aborted) return;
      const next = idx++;
      if (next >= specs.length) return;
      const spec = specs[next]!;
      // Spawn callback is outside the try so the UI gets a row even if
      // the callback itself throws (rare, but a renderer crash could
      // otherwise leave the pool blocked).
      try {
        deps.onSpawn?.(spec);
      } catch (err) {
        log.warn('onSpawn listener threw', { id: spec.id, err });
      }
      const perAgentDeps: SubAgentDeps = {
        selection: deps.selection,
        ...(deps.providerName ? { providerName: deps.providerName } : {}),
        workspacePath: deps.workspacePath,
        workspaceId: deps.workspaceId,
        runId: deps.runId,
        conversationId: deps.conversationId,
        permissions: deps.permissions,
        strictApprovals: deps.strictApprovals,
        signal: deps.signal,
        ...(deps.onToolCall
          ? { onToolCall: (call, subagentId) => deps.onToolCall?.(call, subagentId) }
          : {}),
        ...(deps.onToolResult
          ? { onToolResult: (result, subagentId) => deps.onToolResult?.(result, subagentId) }
          : {}),
        ...(deps.onFileEdit
          ? { onFileEdit: (info, subagentId) => deps.onFileEdit?.(info, subagentId) }
          : {}),
        ...(deps.onTokenUsage
          ? { onTokenUsage: (usage, subagentId) => deps.onTokenUsage?.(usage, subagentId) }
          : {}),
        // Per-sub-agent live-status events. Threaded through the pool so
        // the renderer can surface a worker-scoped status row alongside
        // (or in place of) the orchestrator-level `LiveStatusRow`.
        ...(deps.onRunStatus
          ? { onRunStatus: (event, subagentId) => deps.onRunStatus?.(event, subagentId) }
          : {}),
        ...(deps.onTimelineEvent
          ? { onTimelineEvent: (event, subagentId) => deps.onTimelineEvent?.(event, subagentId) }
          : {}),
        // Per-sub-agent streaming text + reasoning. Forwarded so
        // `handleDelegates` can emit the matching `agent-*` timeline
        // events with `subagentId` attached. Audit fix §1.1.
        ...(deps.onTextDelta
          ? { onTextDelta: (delta, mid, sid) => deps.onTextDelta?.(delta, mid, sid) }
          : {}),
        ...(deps.onTextEnd
          ? { onTextEnd: (mid, sid) => deps.onTextEnd?.(mid, sid) }
          : {}),
        ...(deps.onTextAborted
          ? { onTextAborted: (mid, sid) => deps.onTextAborted?.(mid, sid) }
          : {}),
        ...(deps.onReasoningDelta
          ? { onReasoningDelta: (delta, mid, sid) => deps.onReasoningDelta?.(delta, mid, sid) }
          : {}),
        ...(deps.onReasoningEnd
          ? { onReasoningEnd: (mid, sid, signature) => deps.onReasoningEnd?.(mid, sid, signature) }
          : {}),
        // Streaming partial-args preview for in-flight worker tool
        // calls. Forwarded through verbatim so `handleDelegates` can
        // surface a matching `tool-call-args-delta` timeline event.
        ...(deps.onToolCallArgsDelta
          ? { onToolCallArgsDelta: (snap, sid) => deps.onToolCallArgsDelta?.(snap, sid) }
          : {}),
        // Round-scoped file-inlining cache (audit fix A2). One Map per
        // pool invocation, threaded into every worker so parallel
        // workers sharing files in their `spec.files` lists hit the
        // cache instead of paying the FS read N times over.
        inlineCache: sharedInlineCache
      };
      // Error boundary: a thrown exception from `runSubAgent` must never
      // reject `Promise.all` — the orchestrator expects one verdict per
      // spec. Convert throws into an authoritative `failed`/`aborted`
      // shape so the verifier + three-strike counter run unchanged.
      let run: SubAgentRun;
      try {
        run = await runSubAgent(spec, perAgentDeps);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // An abort-mid-pool surfaces as an `AbortError`. Report as
        // `aborted` so `handleDelegates`'s verdict-structural logic
        // doesn't count it toward the three-strike delegation budget
        // (matching the happy-path aborted behavior inside
        // `runSubAgent`).
        const status: SubAgentRun['status'] =
          isAbortError(err, deps.signal) ? 'aborted' : 'failed';
        log.error('runSubAgent threw — converting to structured run', {
          id: spec.id,
          status,
          error: msg
        });
        run = {
          id: spec.id,
          task: spec.task,
          output: '',
          toolResults: [],
          inlinedFileCount: 0,
          status,
          error: msg
        };
      }
      results[next] = run;
      try {
        deps.onResult?.(run);
      } catch (err) {
        log.warn('onResult listener threw', { id: spec.id, err });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, specs.length); i++) workers.push(worker());
  await Promise.all(workers);
  return fillMissingResults(specs, results, deps.signal);
}

/** Every spec index must resolve to a run — abort mid-pool must not leave holes. */
function fillMissingResults(
  specs: SubAgentSpec[],
  results: SubAgentRun[],
  signal: AbortSignal
): SubAgentRun[] {
  const filled: SubAgentRun[] = new Array(specs.length);
  for (let i = 0; i < specs.length; i++) {
    const existing = results[i];
    if (existing !== undefined) {
      filled[i] = existing;
      continue;
    }
    const spec = specs[i]!;
    filled[i] = {
      id: spec.id,
      task: spec.task,
      output: '',
      toolResults: [],
      inlinedFileCount: 0,
      status: signal.aborted ? 'aborted' : 'failed',
      ...(signal.aborted
        ? {}
        : { error: 'Sub-agent pool exited before this worker started' })
    };
  }
  return filled;
}
