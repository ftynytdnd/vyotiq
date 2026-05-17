/**
 * Token-budget calculations for the context summarizer.
 *
 * Two distinct surfaces:
 *
 *   1. **Trigger predicate** — `shouldTrigger(usage, ceiling, rules)`
 *      decides whether the orchestrator's current prompt-token usage
 *      has crossed the configured fraction of the model's context
 *      window. Called per iteration at the top of `runLoop`. Pure /
 *      synchronous.
 *
 *   2. **Range estimator** — `estimateRangeTokens(messages, indices)`
 *      computes a best-effort BPE token count for a contiguous (or
 *      sparse) subset of the messages array, used by the Inspector's
 *      footer + the projected before/after savings. Async because
 *      `tokenCounter.estimateTokens` runs the real tokenizer.
 *
 * Neither function does any I/O beyond what `tokenCounter` already
 * does — both are safe to call inside the orchestrator's hot loop.
 */

import type { ChatMessage, TokenUsage } from '@shared/types/chat.js';
import type { ContextSummaryRules } from '@shared/types/contextSummary.js';
import { estimateTokens } from '../../providers/tokenCounter.js';

/**
 * Decide whether `shouldRunSummarization` is true given the latest
 * provider-reported `TokenUsage` for this run, the model's effective
 * context-window ceiling, and the resolved rules.
 *
 * Returns `false` (no trigger) when:
 *   - rules disabled,
 *   - no usage report yet (the first iteration ran without
 *     `stream_options.include_usage` returning a frame),
 *   - no ceiling resolvable (model's `/v1/models` didn't expose
 *     `context_length` and the user hasn't pinned an override —
 *     same condition `TokenUsagePill` renders as "Set ctx"),
 *   - ratio is below `autoTriggerRatio`.
 *
 * Returns `true` only when the ratio crosses the threshold AND the
 * call is `'auto'`. Manual triggers never go through this predicate
 * — `runManualSummarization` calls `partition` + `streamSummary`
 * directly, ignoring the threshold.
 *
 * Why `latest.promptTokens` (not `total`): only prompt tokens
 * occupy the next request's input slot; `completion_tokens`
 * already streamed back to the user and has no bearing on whether
 * the next turn fits.
 */
export function shouldTrigger(
  usage: TokenUsage | undefined,
  ceiling: number | undefined,
  rules: ContextSummaryRules
): boolean {
  if (!rules.enabled) return false;
  if (!usage) return false;
  if (typeof ceiling !== 'number' || ceiling <= 0) return false;
  const ratio = usage.promptTokens / ceiling;
  return ratio >= rules.autoTriggerRatio;
}

/**
 * Estimate the token cost of a single message.
 *
 * The orchestrator's `messages[]` carries `role + content +
 * (tool_calls | tool_call_id | reasoning_content)` per entry —
 * each contributes to the wire payload. We collapse the relevant
 * fields into a single string and let `tokenCounter.estimateTokens`
 * run the model's actual BPE encoder over it. The result is best-
 * effort (matches what the composer's pre-flight gauge shows for
 * non-attachment user prompts) and never throws.
 *
 * `modelId` is forwarded so the encoder selects the right family
 * (gpt-4o ⇒ o200k, deepseek ⇒ o200k, claude ⇒ heuristic). When
 * unknown the heuristic is chars/3.8 — already documented behavior.
 */
export async function estimateMessageTokens(
  message: ChatMessage,
  modelId: string
): Promise<number> {
  const parts: string[] = [`role:${message.role}`];
  if (typeof message.content === 'string') parts.push(message.content);
  if (typeof message.reasoning_content === 'string') {
    parts.push(message.reasoning_content);
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      parts.push(`tool:${tc.function.name} ${tc.function.arguments}`);
    }
  }
  if (typeof message.tool_call_id === 'string') {
    parts.push(`tool_call_id:${message.tool_call_id}`);
  }
  if (typeof message.name === 'string') parts.push(`name:${message.name}`);
  const result = await estimateTokens({
    modelId,
    prompt: parts.join('\n')
  });
  return result.tokens;
}

/**
 * Estimate the cumulative token cost of a sparse set of message
 * indices. Used by the Inspector to render the projected
 * "before → after" tokens in the trigger footer and by
 * `streamSummary` to stamp `beforeTokens` on the
 * `context-summary-pending` event.
 *
 * Sequential (not parallel) on purpose: the underlying
 * `gpt-tokenizer` call is sync inside one Node tick anyway, and
 * spawning N parallel async wrappers just adds Promise overhead
 * for no wall-clock savings.
 */
export async function estimateRangeTokens(
  messages: ReadonlyArray<ChatMessage>,
  indices: ReadonlyArray<number>,
  modelId: string
): Promise<number> {
  let total = 0;
  for (const idx of indices) {
    const m = messages[idx];
    if (!m) continue;
    total += await estimateMessageTokens(m, modelId);
  }
  return total;
}

/**
 * Pre-computed per-message token costs, parallel-aligned with the
 * `messages` array. Used by the Inspector snapshot builder so each
 * row's `tokenEstimate` is filled without the renderer needing a
 * second IPC round-trip.
 *
 * Errors per message are swallowed (logged at debug inside
 * `estimateTokens`) and produce a `0` so a single broken entry
 * never tanks the whole snapshot.
 */
export async function estimateAllMessageTokens(
  messages: ReadonlyArray<ChatMessage>,
  modelId: string
): Promise<number[]> {
  const out: number[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    try {
      out[i] = await estimateMessageTokens(messages[i]!, modelId);
    } catch {
      out[i] = 0;
    }
  }
  return out;
}
