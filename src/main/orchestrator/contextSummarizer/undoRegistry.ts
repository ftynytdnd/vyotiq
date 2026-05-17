/**
 * Per-run undo registry for context summarizations.
 *
 * Keyed first by `runId`, then by `summaryId`. Each entry stores a
 * snapshot of the orchestrator's `messages: ChatMessage[]` array
 * captured EXACTLY before the splice from `applySummary` was
 * applied. The `undo` IPC restores this snapshot in place.
 *
 * Eviction triggers (kept tight so memory cannot accumulate across a
 * long session):
 *   - the next `user-prompt` event lands on the same run (turn
 *     boundary — undo no longer makes sense after the user has
 *     committed to the compressed state),
 *   - the run terminates (`done` / `error` / abort),
 *   - the user explicitly invokes `undo` (entry is removed after
 *     the splice is reverted).
 *
 * Snapshots are SHALLOW copies of the messages array (each
 * `ChatMessage` is itself immutable in practice — the orchestrator
 * loop appends new entries rather than mutating existing ones).
 * For the system slot at index 0 — which IS rewritten in place per
 * iteration — the undo restores the array structure but NOT the
 * exact harness body that was in effect at splice time; that's
 * fine because the next iteration will rebuild the system slot
 * from the current envelopes anyway.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/contextSummarizer/undoRegistry');

interface RegistryEntry {
  /** Pre-splice snapshot of `messages`. */
  preSplice: ChatMessage[];
  /** Wall-clock when the snapshot was captured (debug surface). */
  appliedAt: number;
  /** Convenience: the message ids that were replaced (matches the
   *  `replacedMessageIds` field on the matching `context-summary-end`
   *  event). Stored so the IPC `undo` can verify the splice still
   *  matches before reverting — defends against a follow-up turn
   *  that already changed `messages[]` shape. */
  replacedMessageIds: string[];
}

/**
 * Two-level Map: `runId → summaryId → RegistryEntry`. Using nested
 * Maps (rather than a flat `${runId}\u0000${summaryId}` key) keeps
 * the per-run cleanup path O(1) — `clearForRun` just `.delete`s the
 * outer key in one shot.
 */
const registry = new Map<string, Map<string, RegistryEntry>>();

/**
 * Capture a pre-splice snapshot for `(runId, summaryId)`. Idempotent
 * — calling twice for the same key replaces the prior snapshot
 * (a re-run summary on the same id should never happen under the
 * current emit contract, but we don't crash if it does).
 */
export function captureSnapshot(opts: {
  runId: string;
  summaryId: string;
  messages: ReadonlyArray<ChatMessage>;
  replacedMessageIds: ReadonlyArray<string>;
}): void {
  const { runId, summaryId, messages, replacedMessageIds } = opts;
  let runMap = registry.get(runId);
  if (!runMap) {
    runMap = new Map();
    registry.set(runId, runMap);
  }
  // Shallow copy of the array; entries are reused by reference.
  const preSplice = messages.slice();
  runMap.set(summaryId, {
    preSplice,
    appliedAt: Date.now(),
    replacedMessageIds: [...replacedMessageIds]
  });
}

/**
 * Look up the snapshot for `(runId, summaryId)`. Returns
 * `undefined` if the entry has been GC'd (next user prompt landed,
 * run ended) or if it never existed.
 */
export function getSnapshot(
  runId: string,
  summaryId: string
): RegistryEntry | undefined {
  return registry.get(runId)?.get(summaryId);
}

/**
 * Drop the snapshot for `(runId, summaryId)`. Called by `undo` after
 * the revert lands so the entry doesn't linger forever — the user
 * can't re-undo the same summary, by design.
 */
export function dropSnapshot(runId: string, summaryId: string): void {
  const runMap = registry.get(runId);
  if (!runMap) return;
  runMap.delete(summaryId);
  if (runMap.size === 0) registry.delete(runId);
}

/**
 * Drop every snapshot for a run. Called from `runLoop`'s `finally`
 * block on every exit path (normal completion, error, abort,
 * iteration cap) so an aborted run with mid-summary state cannot
 * leak its snapshots into the next session.
 *
 * Returns the count of dropped entries for logging. Idempotent.
 */
export function clearForRun(runId: string): number {
  const runMap = registry.get(runId);
  if (!runMap) return 0;
  const count = runMap.size;
  registry.delete(runId);
  if (count > 0) log.debug('cleared undo snapshots for run', { runId, count });
  return count;
}
