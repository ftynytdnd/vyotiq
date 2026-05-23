/**
 * Per-run context registry — exposes a small slice of each in-flight
 * orchestrator run to other main-process modules (the
 * context-summary IPC handlers, the inspector snapshot path) WITHOUT
 * granting them references into the loop's hot-path closure.
 *
 * Pattern: `runLoop` registers a `RunContextHandle` on entry and
 * deregisters in its `finally` block. The IPC handler looks up the
 * handle by `runId` and either reads cached fields (latest usage,
 * resolved rules, latest run-state XML) or invokes the async
 * `triggerManualSummary` / `undo` callbacks the loop wired up.
 *
 * Why a separate registry (rather than extending `AgentV.activeRuns`):
 *   - Keeps `AgentV.ts` thin — its responsibility is lifecycle and
 *     workspace pinning.
 *   - Decouples the IPC layer from `runLoop` internals — the IPC
 *     handler doesn't know about `messages[]`, `latestUsage`, etc.,
 *     it just calls registered callbacks.
 *   - Easier to test — the registry is a vanilla `Map<string,
 *     RunContextHandle>` with no Electron / orchestrator imports.
 *
 * Lifecycle:
 *   - Registered by `runLoop` on entry (right after the loop's local
 *     state is set up).
 *   - Updated in place each iteration (the loop overwrites
 *     `latestUsage`, `latestRunStateXml`, etc.).
 *   - Removed by `runLoop`'s `finally` block on every exit path.
 *   - Looked up by `contextSummary.ipc` handlers; they bail with
 *     `{ ok: false, reason: 'unknown run' }` when no handle exists.
 */

import type { ChatMessage, TokenUsage } from '@shared/types/chat.js';
import type { ContextSummaryRules } from '@shared/types/contextSummary.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orch/runContextRegistry');

/**
 * Async callback the IPC handler invokes to fire a manual
 * summarization. Resolves with the `summaryId` on success or a
 * `reason` on failure. The implementation lives in `runLoop`
 * because it owns the live `messages` array.
 *
 * Internal — used only inside `RunContextHandle` below.
 */
type ManualTriggerFn = () => Promise<
  | { ok: true; summaryId: string }
  | { ok: false; reason: string }
>;

/**
 * Async callback the IPC handler invokes to undo a previously
 * applied summarization. Resolves `{ ok: true }` if the splice was
 * reverted, `{ ok: false }` if the snapshot was already GC'd or the
 * id is unknown. Lives in `runLoop` because it must mutate the
 * live `messages` array atomically with the loop's pause.
 *
 * Internal — used only inside `RunContextHandle` below.
 */
type UndoFn = (summaryId: string) => Promise<{ ok: boolean }>;

/**
 * Snapshot factory the IPC handler invokes for `inspect()`. Built
 * by `runLoop` so it sees the live `messages` array. Re-runs the
 * partition + token estimation each call (cheap; an Inspector
 * fetch is rare relative to the loop tick).
 *
 * Internal — used only inside `RunContextHandle` below.
 */
type SnapshotFn = () => Promise<
  import('@shared/types/contextSummary.js').ContextInspectorSnapshot
>;

export interface RunContextHandle {
  runId: string;
  /** Matches the generation assigned at `registerRunContext` — used for safe teardown. */
  generation: number;
  conversationId: string;
  workspaceId: string;
  workspacePath: string;
  /** Live reference to the orchestrator's messages array. NOT
   *  cloned — the handle's reader must not mutate it. */
  messages: ChatMessage[];
  /** Original user prompt for the run. Anchors the summarizer's
   *  `<task>` block. */
  originalPrompt: string;
  /** Currently selected model — used as the fallback summarizer
   *  selection when `rules.summarizerSelection === null`. */
  selection: ModelSelection;
  /** Fully-resolved rules (global ← workspace) snapshot at run
   *  start. The auto-trigger uses this; manual-trigger may
   *  re-resolve so a settings change between the snapshot and
   *  the click is honored. */
  rules: ContextSummaryRules;
  /** Most recent provider-reported `TokenUsage` for the run.
   *  Updated by `runLoop` each iteration. `undefined` until the
   *  first usage frame arrives. */
  latestUsage?: TokenUsage;
  /** Most recent `<run_state>` block — passed into the summarizer's
   *  user envelope so it sees the same loop snapshot the
   *  orchestrator does. */
  latestRunStateXml?: string;
  /** Currently in-flight summary id, when one is mid-stream.
   *  Locked to one at a time per run; manual triggers reject
   *  with a friendly reason while this is set. */
  activeSummaryId?: string;
  /** Loop-side callbacks. */
  triggerManual: ManualTriggerFn;
  undo: UndoFn;
  snapshot: SnapshotFn;
  /** Abort only the in-flight summarizer stream (not the whole run). */
  abortSummary: () => boolean;
}

const handles = new Map<string, RunContextHandle>();
const generations = new Map<string, number>();

/**
 * Register a run's handle. Called once by `runLoop` on entry. The
 * passed object is held by reference — the loop is expected to
 * mutate fields like `latestUsage` and `activeSummaryId` in place.
 *
 * Returns the assigned `generation` for generation-safe `unregister`.
 */
export function registerRunContext(handle: RunContextHandle): number {
  if (handles.has(handle.runId)) {
    log.warn('registerRunContext: handle already exists for runId — overwriting', {
      runId: handle.runId,
      conversationId: handle.conversationId
    });
  }
  const generation = (generations.get(handle.runId) ?? 0) + 1;
  generations.set(handle.runId, generation);
  handle.generation = generation;
  handles.set(handle.runId, handle);
  return generation;
}

/**
 * Drop the run's handle when `generation` still matches registration.
 * Skips delete when a superseding run reused the same `runId`.
 */
export function unregisterRunContext(runId: string, generation: number): void {
  const entry = handles.get(runId);
  if (!entry || entry.generation !== generation) return;
  if (generations.get(runId) === generation) generations.delete(runId);
  handles.delete(runId);
}

/**
 * Look up a handle by runId. Returns `undefined` when the run
 * isn't currently active. The IPC handler treats this as the
 * "unknown run" branch.
 */
export function getRunContext(runId: string): RunContextHandle | undefined {
  return handles.get(runId);
}

/**
 * List every active run id with its bound conversationId. Used by
 * `chat.ipc`'s persistence path to route a `context-override-set`
 * IPC into the right run's emit sink (when a run is in flight) so
 * the renderer mirror updates synchronously without waiting for
 * the snapshot-changed broadcast.
 */
export function listActiveRunContexts(): Array<{
  runId: string;
  conversationId: string;
}> {
  const out: Array<{ runId: string; conversationId: string }> = [];
  for (const h of handles.values()) {
    out.push({ runId: h.runId, conversationId: h.conversationId });
  }
  return out;
}

/**
 * Find the (at most one) active run handle for a given conversation.
 * Used by the override IPC: when the user toggles a per-message
 * override on a conversation that has an in-flight run, we route
 * the persisted event through the run's emit sink so the renderer's
 * timeline gets the update via the live channel (matches every
 * other persisted event's flow). When no run is active for the
 * conversation, the IPC writes the override event directly into
 * the JSONL via `appendEvent` instead.
 */
export function findActiveRunByConversation(
  conversationId: string
): RunContextHandle | undefined {
  for (const h of handles.values()) {
    if (h.conversationId === conversationId) return h;
  }
  return undefined;
}
