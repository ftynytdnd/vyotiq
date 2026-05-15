/**
 * Transcript-aware summarization. Audit fix §2.2.
 *
 * Compacts the OLDEST half of a `ChatMessage[]` into a single
 * `<history_summary>…</history_summary>` body via a one-shot
 * non-streaming LLM call. Used by the run-loop as the last-resort
 * lever once the per-turn trim policy (§2.3) has exhausted its
 * structured-drop options (envelopes + old tool round pairs) but
 * the request still overshoots the model's effective context window.
 *
 * Strategy:
 *   - Preserve the system message (index 0) and the live tail
 *     (most recent assistant turn + any subsequent tool/user
 *     messages — anything from the most recent user prompt onward).
 *   - Project everything in between into a compact transcript
 *     and ask the same provider/model the run is using to write a
 *     200-400 token summary, focused on actions taken, decisions
 *     made, and unresolved questions.
 *   - Return the summary body. Caller is responsible for splicing
 *     the synthetic message into the rolling history AND emitting
 *     the persistent `history-summary` event with the matching
 *     `replacedEventIds` set.
 *
 * Pure-ish: makes ONE network call. Returns `null` on any failure
 * path (provider error, timeout, empty body) so the caller can
 * fall through to the existing graceful-degradation path. NEVER
 * throws.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { streamChat } from '../../providers/chatClient.js';
import { logger } from '../../logging/logger.js';
import { isAbortError } from '../abortSignal.js';

const log = logger.child('orch/summarizeHistory');

/**
 * Sub-cap on per-message body chars folded into the summarizer
 * prompt. Even a single huge replayed `<subagent_results>` envelope
 * could blow our own summarizer call past the window otherwise.
 */
const PER_MESSAGE_PROJECTION_CAP = 4_000;

/**
 * Fraction of the post-trim message array we summarize. The OLDEST
 * `SUMMARIZE_FRACTION` of the eligible range collapses into one
 * synthetic message; the newer half flows through unchanged. Tuned
 * conservatively so the model still sees substantial recent history
 * verbatim — summaries lose nuance, recent turns shouldn't.
 */
const SUMMARIZE_FRACTION = 0.5;

/**
 * Hard cap on summarizer output to prevent run-away responses.
 *
 * Audit A-32: this is the `max_tokens` ceiling sent to the provider —
 * a SAFETY net, not a target. The PROSE TARGET ("stay under N tokens")
 * baked into `SUMMARIZER_SYSTEM_PROMPT` is intentionally smaller than
 * this ceiling so a model that lands right at its self-imposed limit
 * still has headroom to finish its final bullet cleanly, rather than
 * hitting the hard cap mid-sentence. ~100-token gap is plenty for a
 * well-behaved tail.
 */
const SUMMARY_MAX_TOKENS = 600;
/** Soft prose target communicated to the model in the system prompt. */
const SUMMARY_PROSE_TARGET_TOKENS = 500;

/**
 * Hard ceiling on summarizer wall-clock latency. Long summarizer
 * calls are pure overhead in the user's eyes; if the provider hangs
 * we'd rather give up and let the next iteration's normal trim path
 * try again than block the assistant turn forever.
 */
const SUMMARY_TIMEOUT_MS = 30_000;

export interface SummarizeOpts {
  selection: ModelSelection;
  /** Run-scoped abort signal; honored end-to-end. */
  signal: AbortSignal;
}

export interface SummarizeResult {
  /** The summary body, ready to wrap in `<history_summary>` and inject. */
  summary: string;
  /**
   * Indices into the input `messages` array that were folded into the
   * summary. Caller swaps these out for the synthetic message at the
   * EARLIEST of these indices and emits the matching
   * `history-summary` timeline event.
   */
  replacedIndices: number[];
}

/**
 * Identify the index of the FINAL user message — the most recent
 * user prompt of THIS turn. Everything from this index onward is the
 * "live tail" and must NOT be summarized.
 *
 * Returns `-1` when no user message exists (defensive — wouldn't be
 * called by the run-loop in that state, but keeps the helper total).
 */
function lastUserPromptIndex(messages: ReadonlyArray<ChatMessage>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return i;
  }
  return -1;
}

/**
 * Project a `ChatMessage` into a compact role-prefixed string for the
 * summarizer prompt. Mirrors the projection used by `tokenCounter` so
 * the summarizer's OWN context cost is predictable.
 */
function projectMessage(m: ChatMessage): string {
  const parts: string[] = [`[${m.role}]`];
  if (typeof m.content === 'string' && m.content.length > 0) {
    parts.push(m.content);
  } else if ('tool_calls' in m && Array.isArray(m.tool_calls)) {
    parts.push('(tool calls)');
    for (const tc of m.tool_calls) {
      parts.push(`- ${tc.function.name}(${tc.function.arguments.slice(0, 200)})`);
    }
  }
  if ('reasoning_content' in m && typeof m.reasoning_content === 'string') {
    parts.push(`(reasoning) ${m.reasoning_content.slice(0, PER_MESSAGE_PROJECTION_CAP)}`);
  }
  if ('name' in m && typeof m.name === 'string') {
    parts.push(`(tool=${m.name})`);
  }
  const joined = parts.join(' ');
  return joined.length > PER_MESSAGE_PROJECTION_CAP
    ? joined.slice(0, PER_MESSAGE_PROJECTION_CAP) + '…[truncated]'
    : joined;
}

const SUMMARIZER_SYSTEM_PROMPT = `You are an assistant tasked with compacting a long chat transcript so the orchestrator running the chat can fit the rest of the conversation in its context window.

Write a focused, neutral summary of the transcript fragment between <transcript> tags. Cover:
1. The user's overall goal and any sub-goals.
2. Files / paths / functions / decisions discussed.
3. Outcomes of any tool calls or sub-agent rounds.
4. Open questions or unresolved items.

Rules:
- Return ONLY the summary body — no preamble, no closing remarks, no markdown headers above the summary.
- Use compact bullet lists where the source uses lists; otherwise short paragraphs.
- Preserve concrete details (paths, ids, function names) verbatim. NEVER hallucinate.
- Stay under ${SUMMARY_PROSE_TARGET_TOKENS} tokens.`;

/**
 * Run the summarizer. Returns `null` on any failure path so the
 * caller can fall through gracefully.
 */
export async function summarizeOlderTurns(
  messages: ReadonlyArray<ChatMessage>,
  opts: SummarizeOpts
): Promise<SummarizeResult | null> {
  if (messages.length < 4) {
    // Not enough history to bother summarizing — system + user +
    // assistant + maybe one more is too short for compression to help.
    return null;
  }
  // Range eligible for summarization: index 1 (after system) up to
  // BUT NOT INCLUDING the final user prompt. Anything from the final
  // user prompt onward is the active turn's tail and stays verbatim.
  const tailStart = lastUserPromptIndex(messages);
  if (tailStart <= 1) return null;
  const eligibleEnd = tailStart; // exclusive
  const eligibleStart = 1; // exclusive of system
  const eligibleSpan = eligibleEnd - eligibleStart;
  if (eligibleSpan < 2) return null;

  // Summarize the OLDEST `SUMMARIZE_FRACTION` of the eligible range.
  const summarizeCount = Math.max(2, Math.floor(eligibleSpan * SUMMARIZE_FRACTION));
  const replacedIndices: number[] = [];
  for (let i = eligibleStart; i < eligibleStart + summarizeCount; i++) {
    replacedIndices.push(i);
  }

  // Build the transcript projection.
  const transcript = replacedIndices
    .map((i) => projectMessage(messages[i]!))
    .join('\n\n---\n\n');
  const userPrompt = `<transcript>\n${transcript}\n</transcript>`;

  // Bound the wall-clock so a hung summarizer can't wedge the run.
  const summaryAbort = new AbortController();
  const linkAbort = (): void => summaryAbort.abort();
  const timeoutId = setTimeout(() => summaryAbort.abort(), SUMMARY_TIMEOUT_MS);
  if (opts.signal.aborted) summaryAbort.abort();
  opts.signal.addEventListener('abort', linkAbort, { once: true });

  let assistantText = '';
  try {
    for await (const delta of streamChat({
      providerId: opts.selection.providerId,
      model: opts.selection.modelId,
      messages: [
        { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      maxTokens: SUMMARY_MAX_TOKENS,
      signal: summaryAbort.signal
    })) {
      if (delta.contentDelta) assistantText += delta.contentDelta;
    }
  } catch (err) {
    if (isAbortError(err, opts.signal)) {
      log.debug('summarizer aborted by run signal');
    } else if (isAbortError(err, summaryAbort.signal)) {
      log.warn('summarizer timed out', { timeoutMs: SUMMARY_TIMEOUT_MS });
    } else {
      log.warn('summarizer call failed', {
        msg: err instanceof Error ? err.message : String(err)
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
    opts.signal.removeEventListener('abort', linkAbort);
  }

  const summary = assistantText.trim();
  if (summary.length === 0) {
    log.debug('summarizer returned empty body');
    return null;
  }
  return { summary, replacedIndices };
}
