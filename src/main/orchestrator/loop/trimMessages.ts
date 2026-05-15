/**
 * Per-turn token-budget enforcement. Audit fix §2.3.
 *
 * Strategy (executed in this order, re-estimating after each pass):
 *
 *   1. **Drop oldest verified `<subagent_results>` envelopes** (user
 *      messages whose body opens with the envelope tag). Sub-agent
 *      output is the single largest payload class in long
 *      conversations (each round can carry several KB of structured
 *      results), and the orchestrator's reconstructed memory only
 *      cares about the LATEST round to drive the next iteration.
 *      Older envelopes are pure history weight.
 *
 *   2. **Drop oldest tool round pairs** — an `assistant` message with
 *      `tool_calls` plus all immediately-following `role: 'tool'`
 *      results that pair with those calls. We always keep the FINAL
 *      tool round (it's the model's freshest scratch state) and the
 *      assistant message that introduced the user prompt for THIS
 *      turn (a partial drop here would break the canonical
 *      `assistant.tool_calls → tool.results` invariant).
 *
 *   3. **Stop** once the projected token count is at or below
 *      `targetTokens`, OR there's nothing left to safely drop. The
 *      caller decides what to do next — typically emit a
 *      `run-status: 'trimming'` event with the trimmed-message count
 *      and proceed; if even after these passes we're still over,
 *      fall through to whatever the §2.2 summarization path does
 *      (or, when summarization is disabled, just let the provider
 *      reject the request — `runLoop`'s retry policy already handles
 *      that gracefully).
 *
 * NEVER touches:
 *   - The system message at index 0 (it's rebuilt every iteration
 *     from envelopes + harness; trimming it would be pointless and
 *     would break `runLoop`'s "messages[0] is system" invariant).
 *   - The most recent user prompt (the active turn's question).
 *   - The most recent assistant turn and any subsequent tool / user
 *     messages (the "live" tail of the conversation).
 *   - Raw `user` messages without a `<subagent_results>` envelope —
 *     those are real prompts the user typed; dropping them would
 *     corrupt the conversation's intent.
 *
 * Pure / immutable: returns a new array. Caller swaps in if the trim
 * actually shrank the history.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { estimateMessagesTokens } from '../../providers/tokenCounter.js';

export interface TrimResult {
  /** Trimmed message array (input array is never mutated). */
  messages: ChatMessage[];
  /** Pre-trim token estimate for `inputMessages`. */
  tokensBefore: number;
  /** Post-trim token estimate for the returned `messages`. */
  tokensAfter: number;
  /** Number of messages removed. `0` when no trim was needed. */
  trimmedMessages: number;
}

/**
 * Returns true when the user message looks like a verified
 * `<subagent_results>` envelope produced by `handleDelegates`.
 * Conservative match (checks the open tag near the body's start)
 * so a user prompt that mentions the string in passing isn't
 * eligible for dropping.
 */
function isSubagentResultsEnvelope(m: ChatMessage): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content !== 'string') return false;
  // The envelope is always pushed with the literal opening tag at
  // the start of the body — see `handleDelegates.ts`.
  return m.content.startsWith('<subagent_results');
}

/**
 * Returns the count of consecutive `role: 'tool'` messages starting
 * at `idx` (inclusive). Used to pair an assistant.tool_calls message
 * with all of its result responses for atomic removal.
 */
function countTrailingToolMessages(messages: ChatMessage[], idx: number): number {
  let n = 0;
  for (let i = idx; i < messages.length; i++) {
    if (messages[i]!.role === 'tool') n++;
    else break;
  }
  return n;
}

/**
 * Identifies the index of the most recent (last) assistant message
 * that introduced a tool round — i.e. has `tool_calls.length > 0`.
 * Used so we never drop the LIVE tool round that the orchestrator
 * just built; only OLDER rounds are eligible.
 */
function lastToolRoundIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the index of the FIRST verified `<subagent_results>` envelope
 * in `messages`. Returns `-1` when none remain. Skips index 0 (system
 * message — never an envelope but defensive).
 */
function firstSubagentEnvelopeIndex(messages: ChatMessage[]): number {
  for (let i = 1; i < messages.length; i++) {
    if (isSubagentResultsEnvelope(messages[i]!)) return i;
  }
  return -1;
}

/**
 * Finds the FIRST eligible old tool round to drop. An assistant
 * message with `tool_calls.length > 0` whose index is strictly less
 * than `lastToolRoundIdx`. Skips index 0 for the same defensive
 * reason as above.
 */
function firstOldToolRoundIndex(
  messages: ChatMessage[],
  lastToolRoundIdx: number
): number {
  for (let i = 1; i < messages.length; i++) {
    if (i === lastToolRoundIdx) return -1; // reached the live round
    const m = messages[i]!;
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return i;
    }
  }
  return -1;
}

export interface EnforceContextBudgetOpts {
  /** Effective context window in tokens (already resolved). */
  contextWindow: number;
  /**
   * Fraction of `contextWindow` we aim to stay under. Default 0.85 —
   * leaves a comfortable margin for the model's reply tokens (the
   * provider rejects requests where prompt+completion exceeds the
   * window, so we MUST leave headroom). Audit fix §2.3.
   */
  targetFraction?: number;
  /** Model id used for tokenizer encoding selection. */
  modelId: string;
}

const DEFAULT_TARGET_FRACTION = 0.85;

/**
 * Apply the trim policy. Returns a `TrimResult` with the (possibly
 * unchanged) messages array. Callers decide whether to swap and
 * whether to emit a `run-status: 'trimming'` event. When the message
 * array is already at or below target, this is a near-zero-cost
 * estimate-and-return.
 */
export function enforceContextBudget(
  inputMessages: ChatMessage[],
  opts: EnforceContextBudgetOpts
): TrimResult {
  const targetFraction =
    typeof opts.targetFraction === 'number' && opts.targetFraction > 0
      ? Math.min(opts.targetFraction, 1)
      : DEFAULT_TARGET_FRACTION;
  const targetTokens = Math.floor(opts.contextWindow * targetFraction);

  const tokensBefore = estimateMessagesTokens(inputMessages, opts.modelId);
  if (tokensBefore <= targetTokens) {
    return {
      messages: inputMessages,
      tokensBefore,
      tokensAfter: tokensBefore,
      trimmedMessages: 0
    };
  }

  // Work on a copy so the caller's array is never mutated.
  let messages: ChatMessage[] = [...inputMessages];
  let removed = 0;

  // Pass 1 — drop oldest sub-agent envelopes.
  while (estimateMessagesTokens(messages, opts.modelId) > targetTokens) {
    const idx = firstSubagentEnvelopeIndex(messages);
    if (idx === -1) break;
    messages = [...messages.slice(0, idx), ...messages.slice(idx + 1)];
    removed += 1;
  }

  // Pass 2 — drop oldest tool round pairs (assistant.tool_calls +
  // matching `role:'tool'` results). Always preserve the most recent
  // tool round so the LIVE conversation tail stays intact.
  while (estimateMessagesTokens(messages, opts.modelId) > targetTokens) {
    const lastIdx = lastToolRoundIndex(messages);
    const idx = firstOldToolRoundIndex(messages, lastIdx);
    if (idx === -1) break;
    const toolCount = countTrailingToolMessages(messages, idx + 1);
    const total = 1 + toolCount;
    messages = [...messages.slice(0, idx), ...messages.slice(idx + total)];
    removed += total;
  }

  const tokensAfter = estimateMessagesTokens(messages, opts.modelId);
  return {
    messages,
    tokensBefore,
    tokensAfter,
    trimmedMessages: removed
  };
}
