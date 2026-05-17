/**
 * Replay-time compression — re-apply persisted `context-summary-end`
 * splices on top of a freshly-rebuilt `messages: ChatMessage[]`
 * array.
 *
 * Why this layer exists: `replayTranscript` walks the JSONL events
 * in order and rebuilds the orchestrator's `messages[]` from the
 * USER-FACING events (user-prompt, agent-text-delta runs, tool-call
 * + tool-result pairs, subagent-result envelopes). Summarization
 * mutates that array IN PLACE (`applySummary`) at runtime, so the
 * rebuilt array is the PRE-summary shape — which is wrong: when
 * the user reloads the conversation we want them to see (and the
 * model to receive on the next turn) the COMPRESSED shape they
 * left off with.
 *
 * The persisted `context-summary-end` event carries everything we
 * need to re-do that splice deterministically:
 *   - `replacedMessageIds`: the stable ids of the entries to remove.
 *   - `finalText`: the body to wrap in a `<context_summary>` system
 *     envelope.
 *   - `summaryId`: the attribute on the envelope.
 *
 * `context-summary-undone` events are persisted when the user
 * Undid a summarization before the next user-prompt landed; they
 * cancel the matching `-end` event in this replay pass.
 *
 * Pure / synchronous. Identifies messages via `messageWindow.
 * identifyAll` so the ids match what the live runtime would
 * compute for the same array.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { wrapAsContextSummaryEnvelope } from './summarizerPrompt.js';
import { identifyAll } from './messageWindow.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/contextSummarizer/replayCompression');

/**
 * Subset of TimelineEvent fields this module consumes. Local types
 * to avoid pulling the entire union here. Replay needs three kinds:
 *
 *   - `context-summary-pending` — carries `replacedMessageIds` and
 *     the open marker. Always emitted BEFORE the matching `-end`.
 *   - `context-summary-end` — finalises the splice with `finalText`.
 *   - `context-summary-undone` — cancels a prior `(pending, end)`
 *     pair when the user clicked Undo before the next user-prompt.
 *
 * Replay pairs `pending` + `end` by `summaryId`; an unpaired
 * `pending` (run aborted mid-stream — `aborted` event landed) is
 * skipped because no splice ever happened on the live side.
 */
interface SummaryPendingEvent {
  kind: 'context-summary-pending';
  summaryId: string;
  replacedMessageIds: ReadonlyArray<string>;
}
interface SummaryEndEvent {
  kind: 'context-summary-end';
  summaryId: string;
  finalText: string;
}
interface SummaryUndoneEvent {
  kind: 'context-summary-undone';
  summaryId: string;
}
type SummaryEvent =
  | SummaryPendingEvent
  | SummaryEndEvent
  | SummaryUndoneEvent;

/**
 * Apply every persisted summary-end event (in transcript order, with
 * subsequent `-undone` events cancelling earlier `-end`s) to
 * `messages` in place. Returns the count of splices that landed.
 *
 * Algorithm:
 *
 *   1. Walk `events` once and resolve each `summaryId` to its
 *      LAST status: an `-end` followed by an `-undone` (no
 *      subsequent `-end` for the same id) is a no-op; an `-end`
 *      with no matching `-undone` is an active splice.
 *   2. For every active splice, compute the current ids of
 *      `messages` via `identifyAll`. Find the contiguous range
 *      whose ids match `replacedMessageIds` and splice it.
 *   3. If the range cannot be located (transcript drift after a
 *      manual edit, ID hash drift across an app upgrade), log a
 *      warn and SKIP the splice — better to over-restore than to
 *      corrupt the array shape with a wrong splice.
 *
 * The contiguous range is located by scanning for the LEFTMOST
 * subsequence match of `replacedMessageIds` against `currentIds`.
 * This handles the common case (no out-of-band edits) cleanly and
 * fails closed on any mismatch.
 */
export function replayCompression(
  messages: ChatMessage[],
  events: ReadonlyArray<SummaryEvent>
): number {
  const activeSummaries = collectActiveSummaries(events);
  let splicesApplied = 0;
  for (const summary of activeSummaries) {
    const currentIds = identifyAll(messages);
    const range = locateSubsequence(currentIds, summary.replacedMessageIds);
    if (!range) {
      log.warn('replayCompression: replaced range not found; skipping splice', {
        summaryId: summary.summaryId,
        wantedCount: summary.replacedMessageIds.length,
        haveCount: currentIds.length
      });
      continue;
    }
    const envelope = wrapAsContextSummaryEnvelope({
      summaryId: summary.summaryId,
      finalText: summary.finalText
    });
    const synthetic: ChatMessage = { role: 'system', content: envelope };
    messages.splice(range.startIdx, range.endIdx - range.startIdx, synthetic);
    splicesApplied += 1;
  }
  if (splicesApplied > 0) {
    log.debug('replayCompression: applied splices', { count: splicesApplied });
  }
  return splicesApplied;
}

/**
 * Composite "summary record" the splice walker consumes — pairs a
 * `pending` event (carries `replacedMessageIds`) with its matching
 * `end` event (carries `finalText`). Built once per
 * `replayCompression` call from the input stream.
 */
interface ResolvedSummary {
  summaryId: string;
  finalText: string;
  replacedMessageIds: ReadonlyArray<string>;
}

/**
 * Resolve the final status of every `summaryId` mentioned in the
 * event stream. A summary is "active" when:
 *   - a matching `pending` AND `end` event were both observed, AND
 *   - no subsequent `undone` event landed.
 *
 * Returns the active set in transcript order — `replayCompression`
 * walks them sequentially because each splice changes the id space
 * the next splice operates against.
 *
 * Single-pass O(n) walk over the events; storage is one entry per
 * unique `summaryId`, which is bounded by the number of summaries
 * ever attempted on the conversation (typically a handful).
 */
function collectActiveSummaries(
  events: ReadonlyArray<SummaryEvent>
): ResolvedSummary[] {
  /** Working state per summaryId. `cancelled === true` short-
   *  circuits subsequent emits even if a later `end` lands (matches
   *  the live-side undo contract — once undone, never re-applied). */
  interface WorkEntry {
    pending?: SummaryPendingEvent;
    end?: SummaryEndEvent;
    cancelled: boolean;
  }
  const work = new Map<string, WorkEntry>();
  for (const ev of events) {
    let entry = work.get(ev.summaryId);
    if (!entry) {
      entry = { cancelled: false };
      work.set(ev.summaryId, entry);
    }
    if (ev.kind === 'context-summary-pending') {
      entry.pending = ev;
    } else if (ev.kind === 'context-summary-end') {
      entry.end = ev;
    } else {
      // 'context-summary-undone'
      entry.cancelled = true;
    }
  }
  const active: ResolvedSummary[] = [];
  for (const [summaryId, entry] of work) {
    if (entry.cancelled) continue;
    if (!entry.pending || !entry.end) continue;
    active.push({
      summaryId,
      finalText: entry.end.finalText,
      replacedMessageIds: entry.pending.replacedMessageIds
    });
  }
  return active;
}

/**
 * Locate the LEFTMOST contiguous subsequence of `currentIds` that
 * matches `wanted`. Returns `{ startIdx, endIdx }` (half-open) on
 * a match, or `undefined` when no contiguous match exists.
 *
 * The implementation is the trivial O(n × m) scan; transcripts
 * never have more than a few thousand messages and a few summaries,
 * so KMP-level optimization isn't worth the complexity.
 */
function locateSubsequence(
  currentIds: ReadonlyArray<string>,
  wanted: ReadonlyArray<string>
): { startIdx: number; endIdx: number } | undefined {
  if (wanted.length === 0) return undefined;
  if (wanted.length > currentIds.length) return undefined;
  outer: for (let i = 0; i + wanted.length <= currentIds.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (currentIds[i + j] !== wanted[j]) continue outer;
    }
    return { startIdx: i, endIdx: i + wanted.length };
  }
  return undefined;
}
