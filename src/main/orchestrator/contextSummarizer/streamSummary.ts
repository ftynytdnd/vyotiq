/**
 * Run a single context-summarization LLM call end-to-end.
 *
 * Wires the dedicated summarizer prompt + selected model + the
 * partition's summarizable range into one streaming chat-completion
 * request and emits the matching `context-summary-*` TimelineEvents
 * through the run's `emit` sink so persistence + renderer streaming
 * use the existing IPC bridge.
 *
 * Lifecycle on the wire:
 *
 *     pending  → delta* (text + reasoning) → end
 *     pending  → ... → aborted  (on error / abort / over-retry)
 *
 * The function resolves with `{ ok: true, finalText, beforeTokens,
 * afterTokens, savedPercent }` on success and `{ ok: false, reason }`
 * on any terminal failure. `applySummary` is NOT called from this
 * file; the caller (the orchestrator's `maybeRunSummarization` hook)
 * decides whether to splice based on the result.
 *
 * Retries: up to `rules.maxRetries`; same exponential-backoff helper
 * the orchestrator main loop uses. A user-initiated abort propagates
 * through the run's `signal` and short-circuits the retry ladder.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type {
  ContextSummaryRules,
  PersistedSummaryConfig
} from '@shared/types/contextSummary.js';
import { CONTEXT_SUMMARY_MAX_FINAL_CHARS } from '@shared/constants.js';
import { streamChat } from '../../providers/chatClient.js';
import { isProviderError } from '../../providers/providerError.js';
import { isAbortError } from '../abortSignal.js';
import { backoff } from '../retry.js';
import { logger } from '../../logging/logger.js';
import { buildSummarizerSystemPrompt } from '../../harness/harnessLoader.js';
import { buildSummarizerUserMessage } from './summarizerPrompt.js';
import {
  estimateMessageTokens,
  estimateRangeTokens
} from './tokenBudget.js';
import type { MessageWindowPartition } from './messageWindow.js';

const log = logger.child('orchestrator/contextSummarizer/streamSummary');

/**
 * Emit sink — accepts the full `TimelineEvent` union so the loop's
 * existing `emit` symbol drops in directly without a wrapper. We
 * narrow the events we synthesize below via the helper builders so
 * the discriminated-union shape stays exhaustive.
 */
type SummarizerEmit = (event: TimelineEvent) => void;

export interface StreamSummaryOpts {
  runId: string;
  /** Pinned workspace path; resolves the optional override file. */
  workspacePath?: string;
  /** Pre-computed partition from `messageWindow.partition`. */
  partition: MessageWindowPartition;
  /** Live orchestrator messages (read-only here — the splice is
   *  applied by `applySummary` after this resolves). */
  messages: ReadonlyArray<ChatMessage>;
  /** The original user prompt, anchors the summarizer's `<task>`. */
  originalPrompt: string;
  /** Pre-rendered `<run_state>` block for the summarizer's user
   *  envelope. Optional; the very first iteration may have none. */
  runStateXml?: string;
  /** Resolved rules for this run (global ← workspace collapsed). */
  rules: ContextSummaryRules;
  /** Model to run the summarizer against. Resolved by the caller:
   *  prefer `rules.summarizerSelection`, fall back to the run's
   *  current selection. */
  summarizerSelection: ModelSelection;
  /** Trigger reason — auto (threshold) or manual (user click). */
  trigger: 'auto' | 'manual';
  /** Run-scoped abort signal. Aborts propagate to the streaming
   *  fetch + the inter-retry sleep. */
  signal: AbortSignal;
  /** Where to fan out timeline events. */
  emit: SummarizerEmit;
}

export interface StreamSummaryResult {
  ok: boolean;
  /** Stable id minted at the start of the call. Always set, even
   *  on failure (so the renderer can match the aborted event). */
  summaryId: string;
  /** Estimated tokens of the summarizable range BEFORE compression. */
  beforeTokens: number;
  /** Estimated tokens of the final summary AFTER compression.
   *  `0` on failure. */
  afterTokens: number;
  /** Final compressed summary body. Empty on failure. */
  finalText: string;
  /** `(beforeTokens - afterTokens) / beforeTokens` rounded to 1 dec.
   *  `0` on failure or when before is 0. */
  savedPercent: number;
  /** Reason on failure (provider error message, abort note, etc.). */
  reason?: string;
}

/**
 * Run the summarizer to completion. Caller awaits this; on success
 * they call `applySummary.applySummary` to mutate the orchestrator's
 * messages array in place.
 */
export async function streamSummary(
  opts: StreamSummaryOpts
): Promise<StreamSummaryResult> {
  const summaryId = randomUUID();

  // Compute the dropped-placeholder list (for `placeholder` style).
  const droppedPlaceholders =
    opts.rules.droppedMarkerStyle === 'placeholder'
      ? opts.partition.dropped
        .filter((idx) => {
          // Only placeholders for dropped indices INSIDE the
          // summarizable contiguous range — outside ones leave
          // `messages[]` cleanly without representation in the
          // summary body.
          const startIdx = opts.partition.summarizable[0];
          const endIdx =
            opts.partition.summarizable[opts.partition.summarizable.length - 1];
          return (
            startIdx !== undefined &&
            endIdx !== undefined &&
            idx >= startIdx &&
            idx <= endIdx
          );
        })
        .map((idx) => {
          const id = opts.partition.ids[idx]!;
          const kind = opts.partition.kinds[idx]!;
          const charCount = (opts.messages[idx]?.content ?? '').length;
          return { id, kind, charCount };
        })
      : [];

  // Pre-compute the BEFORE token count. Cheap (sequential, BPE).
  const beforeTokens = await estimateRangeTokens(
    opts.messages,
    opts.partition.summarizable,
    opts.summarizerSelection.modelId
  );

  // Range computed from the partition.
  const range = (() => {
    const idx = opts.partition.summarizable;
    if (idx.length === 0) return { startIdx: 0, endIdx: 0 };
    return {
      startIdx: idx[0]!,
      endIdx: idx[idx.length - 1]! + 1
    };
  })();
  const replacedMessageIds = opts.partition.summarizable.map(
    (i) => opts.partition.ids[i]!
  );
  const droppedMessageIds = opts.partition.dropped.map(
    (i) => opts.partition.ids[i]!
  );
  const config: PersistedSummaryConfig = {
    summarizerSelection: opts.summarizerSelection,
    trigger: opts.trigger,
    droppedMarkerStyle: opts.rules.droppedMarkerStyle
  };

  // Helper closure that emits the open marker. Called ONCE before
  // the first attempt AND again at the start of every subsequent
  // retry attempt (review finding H1). The renderer's reducer
  // resets the `summaries[summaryId]` accumulator on every
  // `context-summary-pending` it sees, so re-emitting between
  // retries discards any text/reasoning the failed attempt(s)
  // streamed and the user sees only the SUCCEEDING attempt's body
  // in `LiveStreamCard`. Without this re-emit, `acc.text` in the
  // renderer accumulates ALL attempts' deltas (the post-`-end`
  // `body` switch to `finalText` masks the bug visually, but the
  // raw `text` slot stays contaminated and any future consumer of
  // `summaries[id].text` would observe it).
  //
  // The chat IPC coalescer's implicit boundary `else` flushes any
  // pending summary delta buffers before persisting this pending
  // event, so the JSONL row order on disk is
  // `pending, deltas, pending, deltas, end` and replay walks the
  // same reducer code path.
  const emitPending = (): void => {
    opts.emit({
      kind: 'context-summary-pending',
      id: randomUUID(),
      ts: Date.now(),
      summaryId,
      range,
      replacedMessageIds,
      droppedMessageIds,
      beforeTokens,
      config
    });
  };
  emitPending();

  // Build the summarizer's static prompt + dynamic user message.
  const { prompt: systemPrompt } = await buildSummarizerSystemPrompt({
    workspacePath: opts.workspacePath
  });
  const userBody = buildSummarizerUserMessage({
    messages: opts.messages,
    partition: opts.partition,
    originalPrompt: opts.originalPrompt,
    ...(opts.runStateXml ? { runStateXml: opts.runStateXml } : {}),
    droppedPlaceholders
  });

  let finalText = '';
  let lastError: unknown;
  // Retry budget. `attempt` is 0-indexed; we run up to
  // `maxRetries + 1` total attempts. Mirrors the orchestrator's
  // self-correction pattern.
  for (let attempt = 0; attempt <= opts.rules.maxRetries; attempt++) {
    if (opts.signal.aborted) {
      const reason = 'Aborted by user';
      opts.emit({
        kind: 'context-summary-aborted',
        id: randomUUID(),
        ts: Date.now(),
        summaryId,
        reason
      });
      return {
        ok: false,
        summaryId,
        beforeTokens,
        afterTokens: 0,
        finalText: '',
        savedPercent: 0,
        reason
      };
    }
    // Re-emit `context-summary-pending` for retry attempts (review
    // finding H1). The FIRST attempt's pending was emitted at the
    // top of this function before the loop started; subsequent
    // attempts re-claim the same `summaryId` with a fresh pending
    // so the renderer reducer resets the per-summary accumulator.
    if (attempt > 0) emitPending();
    try {
      // Each attempt restarts the LOCAL accumulator from scratch.
      // The renderer's accumulator is reset by the `emitPending()`
      // above; persistence-side residual buffers in `chat.ipc`'s
      // `summaryCoalescer` are flushed by the implicit `else`
      // branch when `pending` lands.
      finalText = '';
      const summarizerMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBody }
      ];
      const stream = streamChat({
        providerId: opts.summarizerSelection.providerId,
        model: opts.summarizerSelection.modelId,
        messages: summarizerMessages,
        // The summarizer must NEVER call tools — its only output is
        // the markdown summary body. Force it via `tool_choice:'none'`.
        toolChoice: 'none',
        signal: opts.signal
      });
      for await (const delta of stream) {
        if (delta.contentDelta) {
          // Hard cap: stop persisting once we hit the byte budget.
          // The renderer will see the cap landed on a delta boundary
          // and the final `end` will carry the truncated text.
          if (finalText.length < CONTEXT_SUMMARY_MAX_FINAL_CHARS) {
            const allowed = CONTEXT_SUMMARY_MAX_FINAL_CHARS - finalText.length;
            const piece =
              delta.contentDelta.length <= allowed
                ? delta.contentDelta
                : delta.contentDelta.slice(0, allowed);
            finalText += piece;
            opts.emit({
              kind: 'context-summary-delta',
              id: randomUUID(),
              ts: Date.now(),
              summaryId,
              delta: piece
            });
          }
        }
        if (delta.reasoningDelta) {
          // M3: forward the reasoning delta verbatim without
          // accumulating a local copy. The renderer's reducer
          // owns the canonical `summaries[id].reasoningText`
          // accumulator (reset on each `-pending`); the local
          // mirror that used to live here was never read,
          // never returned, never capped, and on long
          // reasoning-heavy streams grew into many MB of dead
          // memory held for the duration of the call.
          opts.emit({
            kind: 'context-summary-reasoning-delta',
            id: randomUUID(),
            ts: Date.now(),
            summaryId,
            delta: delta.reasoningDelta
          });
        }
      }
      // Stream ended without throwing — done. Compute the after
      // token count and the saved-% for the renderer.
      const afterTokens = await estimateMessageTokens(
        { role: 'system', content: finalText },
        opts.summarizerSelection.modelId
      );
      const savedPercent =
        beforeTokens > 0
          ? Math.round(((beforeTokens - afterTokens) / beforeTokens) * 1000) / 10
          : 0;
      opts.emit({
        kind: 'context-summary-end',
        id: randomUUID(),
        ts: Date.now(),
        summaryId,
        afterTokens,
        finalText,
        savedPercent
      });
      return {
        ok: true,
        summaryId,
        beforeTokens,
        afterTokens,
        finalText,
        savedPercent
      };
    } catch (err) {
      lastError = err;
      if (isAbortError(err, opts.signal)) {
        opts.emit({
          kind: 'context-summary-aborted',
          id: randomUUID(),
          ts: Date.now(),
          summaryId,
          reason: 'Aborted by user'
        });
        return {
          ok: false,
          summaryId,
          beforeTokens,
          afterTokens: 0,
          finalText: '',
          savedPercent: 0,
          reason: 'Aborted by user'
        };
      }
      const friendly = isProviderError(err)
        ? err.friendlyMessage
        : err instanceof Error
          ? err.message
          : String(err);
      log.warn('summarizer attempt failed', {
        attempt,
        runId: opts.runId,
        summaryId,
        err: friendly
      });
      if (attempt >= opts.rules.maxRetries) {
        // Give up. Emit aborted with the last error.
        opts.emit({
          kind: 'context-summary-aborted',
          id: randomUUID(),
          ts: Date.now(),
          summaryId,
          reason: friendly
        });
        return {
          ok: false,
          summaryId,
          beforeTokens,
          afterTokens: 0,
          finalText: '',
          savedPercent: 0,
          reason: friendly
        };
      }
      try {
        await backoff(attempt + 1, { signal: opts.signal });
      } catch {
        // Sleep aborted → user pressed Stop mid-backoff.
        opts.emit({
          kind: 'context-summary-aborted',
          id: randomUUID(),
          ts: Date.now(),
          summaryId,
          reason: 'Aborted by user'
        });
        return {
          ok: false,
          summaryId,
          beforeTokens,
          afterTokens: 0,
          finalText: '',
          savedPercent: 0,
          reason: 'Aborted by user'
        };
      }
    }
  }
  // Defensive — the loop body always returns; this is unreachable.
  const friendly =
    lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
  return {
    ok: false,
    summaryId,
    beforeTokens,
    afterTokens: 0,
    finalText: '',
    savedPercent: 0,
    reason: friendly
  };
}
