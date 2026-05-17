/**
 * Apply / revert a summarization splice on the orchestrator's
 * `messages: ChatMessage[]` array.
 *
 * Splice contract:
 *   - The `summarizable` index range from `messageWindow.partition`
 *     is replaced with ONE synthetic `role:'system'` envelope whose
 *     content is the `<context_summary>` body.
 *   - The `dropped` indices that fall inside the same contiguous
 *     range are also removed (their content was never sent to the
 *     summarizer; the placeholder appears INSIDE the summary body
 *     when `droppedMarkerStyle === 'placeholder'`).
 *   - `preserved` indices outside the range are untouched.
 *   - `preserved` indices INSIDE the contiguous range — should
 *     never happen under a healthy partition, but if a future bug
 *     produces one, we splice EVERY index between the first and
 *     last summarizable index inclusive (the safest way to keep
 *     the wire shape valid). The orchestrator's tool-call ↔
 *     tool-result pairing rule already ensures pairs travel
 *     together inside the partition, so the contiguous splice
 *     never breaks a pair.
 *
 * `applySummary` mutates the array IN PLACE so the orchestrator
 * loop's existing `messages` reference stays valid. The matching
 * `revertSummary` restores from a snapshot in `undoRegistry`.
 *
 * Both functions are sync. The async work (LLM streaming, token
 * estimation) lives in `streamSummary.ts` and resolves BEFORE
 * `applySummary` is called.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { wrapAsContextSummaryEnvelope } from './summarizerPrompt.js';
import { captureSnapshot } from './undoRegistry.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/contextSummarizer/applySummary');

/**
 * Result of an `applySummary` call. The orchestrator threads
 * `replacedMessageIds` and the pre-splice snapshot into the
 * `context-summary-end` event so the renderer can render the
 * before/after diff and the persisted JSONL can drive
 * `replayCompression` on transcript reload.
 */
export interface ApplySummaryResult {
  /** True ⇒ splice landed; false ⇒ no-op (range was already
   *  empty, e.g. a manual trigger raced a parallel apply). */
  applied: boolean;
  /** Index in the new (post-splice) `messages` array where the
   *  synthetic system envelope landed. Always equal to the
   *  `startIdx` of the original range when applied. */
  insertedAt: number;
  /** How many entries were spliced out of `messages`. */
  removedCount: number;
}

/**
 * Splice the summarized range and inject the synthetic envelope.
 *
 * Captures the pre-splice snapshot in `undoRegistry` BEFORE the
 * mutation so a follow-up `undo` IPC can revert byte-for-byte.
 * The capture happens unconditionally — even when `applied`
 * resolves false the snapshot is still useful for debugging
 * (registry GC kicks in on the next user-prompt anyway).
 *
 * `replacedMessageIds` is the list of stable ids
 * (`messageWindow.identify`) for every entry that was spliced
 * out, in original wire order. Persisted on the `context-summary-
 * end` event so replay can rebuild the same splice without
 * re-running the partition pass.
 */
export function applySummary(opts: {
  runId: string;
  summaryId: string;
  /** Live orchestrator messages array — mutated in place. */
  messages: ChatMessage[];
  /** Sorted ascending. The contiguous range to replace. */
  summarizableIndices: ReadonlyArray<number>;
  /** Sorted ascending. Indices to DROP (within or outside the
   *  summarizable range). When inside, they're consumed by the
   *  splice; when outside, they're removed by a separate splice
   *  step AFTER the summary splice. */
  droppedIndices: ReadonlyArray<number>;
  /** Stable ids parallel to `messages` (from
   *  `messageWindow.identify`). Used to compute
   *  `replacedMessageIds`. */
  ids: ReadonlyArray<string>;
  /** Final compressed summary body (already truncated to
   *  `CONTEXT_SUMMARY_MAX_FINAL_CHARS`). Will be wrapped in
   *  `<context_summary>` automatically. */
  finalText: string;
}): ApplySummaryResult {
  const {
    runId,
    summaryId,
    messages,
    summarizableIndices,
    droppedIndices,
    ids,
    finalText
  } = opts;

  if (summarizableIndices.length === 0) {
    log.debug('applySummary: no summarizable indices; no-op', {
      runId,
      summaryId
    });
    return { applied: false, insertedAt: -1, removedCount: 0 };
  }

  // Compute the contiguous range bounded by the first and last
  // summarizable index. The dropped indices INSIDE this range
  // get folded into the splice; dropped indices OUTSIDE require
  // a separate post-splice removal pass.
  const startIdx = summarizableIndices[0]!;
  const endIdx = summarizableIndices[summarizableIndices.length - 1]! + 1; // half-open
  const droppedInside: number[] = [];
  const droppedOutside: number[] = [];
  for (const idx of droppedIndices) {
    if (idx >= startIdx && idx < endIdx) droppedInside.push(idx);
    else droppedOutside.push(idx);
  }

  // The full set of replaced indices = summarizable ∪ droppedInside.
  // We don't actually need the union for the splice (we always
  // remove the entire contiguous range), but we DO need it to
  // compute `replacedMessageIds` accurately.
  const replacedSet = new Set<number>(summarizableIndices);
  for (const idx of droppedInside) replacedSet.add(idx);
  const replacedMessageIds: string[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    if (replacedSet.has(i)) {
      const id = ids[i];
      // M8: enforce the `identifyAll(messages)` parallel-array
      // invariant. The caller (`maybeRunSummarization`) builds
      // `ids` from `messageWindow.identifyAll` which is by
      // construction `messages.length`-aligned; a missing slot
      // would mean the partition pass and the splice pass saw
      // different `messages` references. Silently substituting
      // an empty string here (the previous `ids[i] ?? ''`
      // fallback) would poison `replacedMessageIds` and cause
      // `replayCompression.locateSubsequence` to silently fail
      // on transcript reload — the orchestrator's next run
      // would then have its full pre-summary history back, a
      // surprising "more memory than before close" surface for
      // the user. Throwing here halts the splice so the bug
      // surfaces immediately rather than at reload.
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          `applySummary: parallel-array invariant violated at index ${i} ` +
          `(ids.length=${ids.length}, messages.length=${messages.length}, ` +
          `summaryId=${summaryId}). Refusing to splice with a missing id.`
        );
      }
      replacedMessageIds.push(id);
    }
  }

  // Capture snapshot BEFORE mutation. We snapshot the FULL pre-
  // splice messages array (not just the range) so a future
  // `revertSummary` can restore the orchestrator's reference
  // without us having to reconstruct surrounding entries.
  captureSnapshot({
    runId,
    summaryId,
    messages,
    replacedMessageIds
  });

  // Build the synthetic envelope and splice it in.
  const envelope = wrapAsContextSummaryEnvelope({ summaryId, finalText });
  const synthetic: ChatMessage = {
    role: 'system',
    content: envelope
  };
  const removedCount = endIdx - startIdx;
  messages.splice(startIdx, removedCount, synthetic);

  // Now handle any dropped-outside indices. After the previous
  // splice, indices ABOVE `startIdx` shift by `(removedCount - 1)`
  // (we removed `removedCount` and inserted 1). We walk the
  // outside-dropped indices in DESCENDING wire-original order so
  // each removal doesn't invalidate the next one's adjusted
  // position.
  const sortedOutside = [...droppedOutside].sort((a, b) => b - a);
  for (const originalIdx of sortedOutside) {
    const adjusted =
      originalIdx >= endIdx
        ? originalIdx - removedCount + 1
        : originalIdx; // < startIdx case — no shift
    if (adjusted >= 0 && adjusted < messages.length) {
      messages.splice(adjusted, 1);
    }
  }

  log.info('context summary applied', {
    runId,
    summaryId,
    startIdx,
    removedCount,
    droppedOutside: sortedOutside.length,
    replacedIds: replacedMessageIds.length
  });

  return { applied: true, insertedAt: startIdx, removedCount };
}

/**
 * Revert a previously-applied summarization splice. Called from
 * the IPC handler when the user clicks Undo on the inline
 * `ContextSummaryRow` while it's still the current turn.
 *
 * `messages` is mutated in place so the orchestrator's existing
 * reference stays valid. The pre-splice snapshot replaces the
 * array's contents; surrounding entries the model has emitted
 * AFTER the apply (rare but possible: a sub-agent that finished
 * mid-summary, etc.) are LOST. The harness contract for Undo is
 * "before the next user-prompt only" so this is acceptable —
 * users invoke Undo when they regret the apply, not after letting
 * the agent burn through more turns.
 *
 * Returns the count of restored entries on success, `-1` when the
 * snapshot was not found.
 */
export function revertSummary(opts: {
  runId: string;
  summaryId: string;
  messages: ChatMessage[];
  /** The pre-splice snapshot pulled from `undoRegistry.getSnapshot`. */
  preSplice: ReadonlyArray<ChatMessage>;
}): number {
  const { messages, preSplice, runId, summaryId } = opts;
  // Replace `messages` contents with the snapshot. Mutating in
  // place means the orchestrator loop's `const messages =
  // opts.initialMessages` reference stays valid.
  messages.length = 0;
  for (const m of preSplice) messages.push(m);
  log.info('context summary reverted', {
    runId,
    summaryId,
    restoredCount: preSplice.length
  });
  return preSplice.length;
}
