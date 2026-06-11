/**
 * Shared streaming-delta consumer for chat completions.
 *
 * `handleAssistantTurn` drains `streamChat()` deltas here: accumulate text
 * and reasoning, splice tool-call fragments into per-index buffers, and
 * latch a finish reason. One module keeps provider delta handling consistent.
 *
 * Responsibilities:
 *   1. Native-channel routing: `delta.contentDelta` → text accumulator,
 *      `delta.reasoningDelta` → reasoning accumulator. The provider has
 *      already classified these for us.
 *   2. Inline-reasoning routing: `delta.contentDelta` is run through
 *      `InlineReasoningRouter` first, which reclassifies inline
 *      `<think>` / `<thinking>` blocks (emitted by models that lack a
 *      native reasoning channel) into the reasoning channel. Both
 *      classification paths feed the SAME accumulators / hooks
 *      downstream — by the time anything escapes this helper, "text"
 *      and "reasoning" are already the right contents regardless of
 *      how the model encoded them on the wire.
 *   3. Tool-call splicing: per-index buffers assembled from streaming
 *      `delta.toolCallDelta` fragments.
 *   4. Reasoning-end transition: fires `onReasoningEnd` exactly once,
 *      the moment the stream transitions reasoning → content/tool_call,
 *      so the renderer's reasoning panel can collapse without waiting
 *      for the full turn to finish.
 *   5. Finish-reason + final-usage frame propagation.
 *
 * Optional `hooks` let the orchestrator emit timeline events as text arrives
 * without leaking renderer concerns into the helper.
 */

import type { TokenUsage } from '@shared/types/chat.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import type { ChatStreamDelta } from '../../providers/chatClient.js';
import { InlineReasoningRouter } from './inlineReasoningRouter.js';

export interface PartialToolCall {
  id?: string;
  name?: string;
  argumentsBuf: string;
  /**
   * Gemini-only: thoughtSignature attached to a streamed `functionCall`
   * part. Captured on the same delta that names the call so the
   * orchestrator can persist it onto `ToolCall.thoughtSignature` after
   * argument JSON parses, ready to be echoed back on the next request.
   * Anthropic's signature lives on the assistant message
   * (`reasoning_signature`), not per tool call, so it stays absent for
   * the `anthropic-native` path.
   */
  thoughtSignature?: string;
}

export interface StreamConsumeResult {
  assistantText: string;
  reasoningText: string;
  partialToolCalls: PartialToolCall[];
  hadText: boolean;
  hadReasoning: boolean;
  /**
   * True once the consumer has observed the reasoning → text (or
   * reasoning → tool-call) transition and fired the `onReasoningEnd`
   * hook. Lets the caller know whether the reasoning-end marker has
   * already been dispatched mid-stream so it doesn't double-emit at
   * turn boundary. A pure-reasoning turn (no content / tool-call
   * follow-up) leaves this `false` — the caller is responsible for
   * emitting the closing marker in that case.
   */
  reasoningEndEmitted: boolean;
  /**
   * Anthropic-only: cumulative thinking-block signature concatenated
   * across every `reasoningSignature` delta the transport yielded for
   * this turn. The orchestrator persists this onto
   * `ChatMessage.reasoning_signature` so the next request echoes it
   * back unchanged (required by Claude thinking models for plan
   * continuity). Other dialects leave it `undefined`.
   */
  reasoningSignature?: string;
  finishReason?: string;
  /**
   * Provider-reported token usage for the turn. Present iff the upstream
   * provider honors `stream_options.include_usage` (OpenAI canonical,
   * DeepSeek v4+, Groq, Together, vLLM, LM Studio). Missing for providers
   * that ignore the flag — callers must handle `undefined` gracefully.
   */
  usage?: TokenUsage;
  /** Anthropic response id for cache-diagnostics chaining on the next turn. */
  anthropicMessageId?: string;
  /** Anthropic cache-diagnostics miss reason when the beta header is enabled. */
  anthropicCacheMissReason?: string | null;
}

/**
 * Resolve which `partialToolCalls[]` slot a streaming delta belongs in.
 *
 * OpenAI-class transports splice argument fragments by `index`. Some
 * OpenAI-compat backends (observed with parallel tool calls on DeepSeek-
 * class and Ollama-Cloud routes) emit each *new* call in its own SSE
 * frame while reusing `index: 0`. Feeding those into slot 0 merges
 * unrelated calls, executes only the survivor, and leaves orphan
 * partial UI rows that render as "Unknown tool: (unspecified)".
 */
function resolveToolCallIndex(
  partialToolCalls: PartialToolCall[],
  proposedIndex: number,
  incomingId: string | undefined
): number {
  let idx = proposedIndex;
  const occupant = partialToolCalls[idx];
  if (occupant === undefined) return idx;
  if (incomingId === undefined || occupant.id === undefined || occupant.id === incomingId) {
    return idx;
  }
  const hasPriorContent =
    occupant.argumentsBuf.length > 0 ||
    occupant.name !== undefined ||
    occupant.id !== undefined;
  if (!hasPriorContent) return idx;
  idx = partialToolCalls.length;
  while (partialToolCalls[idx] !== undefined) idx++;
  return idx;
}

export interface StreamConsumeHooks {
  /** Fired after each text delta is appended. The accumulated string is
   *  passed for callers that want to log progress windows. */
  onTextDelta?: (delta: string, accumulated: string) => void;
  /** Fired after each reasoning delta is appended. */
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  /**
   * Fired exactly once per turn, the moment the reasoning stream
   * transitions to the text (or tool-call) stream. The trigger is the
   * FIRST `contentDelta` or `toolCallDelta` observed after at least one
   * `reasoningDelta` — i.e. the point at which the provider has stopped
   * emitting `reasoning_content` and switched to `content` /
   * `tool_calls`. Not fired at all when a turn has no reasoning, or
   * when the turn is pure reasoning with no content/tool follow-up
   * (the caller is responsible for the closing marker in that case).
   *
   * The optional `signature` arg carries the Anthropic thinking-block
   * signature that closed the reasoning stream — concatenated across
   * all `reasoningSignature` frames that landed during the reasoning
   * phase. Anthropic order guarantees every `signature_delta` lands
   * inside its parent `content_block_delta` range (i.e. before
   * `content_block_stop`, which itself precedes the first downstream
   * `text_delta`); the value is therefore already settled by the
   * time `onReasoningEnd` fires. Other dialects pass `undefined`.
   *
   * This exists so the renderer's reasoning panel can collapse the
   * instant reasoning is truly done, without waiting for the full
   * turn (including long tool-call tails) to finish streaming.
   */
  onReasoningEnd?: (signature?: string) => void;
  /**
   * Fired when the final usage frame arrives. Called at most once per
   * turn; not called at all for providers that ignore
   * `stream_options.include_usage`. The same value also lands in
   * `StreamConsumeResult.usage`, so callers can pick whichever surface
   * (hook for eager emission, result for after-stream bookkeeping).
   */
  onUsage?: (usage: TokenUsage, meta?: { cacheMissReason?: string | null }) => void;
  /**
   * Fired AFTER every `argumentsDelta` fragment has been folded into
   * the per-index buffer. The snapshot carries the cumulative
   * `argsBuf` (not the per-frame delta) so the consumer is robust to
   * dropped IPC frames — the latest snapshot always supersedes
   * earlier ones for the same call.
   *
   * Used by the orchestrator to emit
   * `tool-call-args-delta` timeline events so the renderer can paint
   * a live partial-args preview (e.g. streaming diff for `edit`,
   * live path label for `read`/`ls`, streaming query for `search`)
   * BEFORE the matching authoritative `tool-call` event lands. Pure
   * live telemetry — the event is intentionally non-persistent.
   *
   * `id` is the provider-assigned call id once known; OpenAI
   * typically reports it on the first delta, Ollama not at all (its
   * single-frame delivery makes the live-preview path moot anyway).
   * `name` likewise lands on the first delta for OpenAI-class
   * streams.
   */
  onToolCallArgsDelta?: (snapshot: {
    index: number;
    id: string | undefined;
    name: string | undefined;
    argsBuf: string;
  }) => void;
}

/**
 * Drains an async-iterable of chat-stream deltas into a flat result.
 * Throws whatever the underlying iterator throws — the caller is
 * responsible for retry/backoff policy.
 */
export async function consumeChatStream(
  stream: AsyncIterable<ChatStreamDelta>,
  hooks?: StreamConsumeHooks
): Promise<StreamConsumeResult> {
  let assistantText = '';
  let reasoningText = '';
  const partialToolCalls: PartialToolCall[] = [];
  let hadText = false;
  let hadReasoning = false;
  let reasoningEndEmitted = false;
  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;
  let anthropicMessageId: string | undefined;
  let anthropicCacheMissReason: string | null | undefined;
  let usageEmittedWithMissReason = false;
  // Anthropic thinking-block signature. The transport may yield multiple
  // `reasoningSignature` frames per turn (one per closing thinking block);
  // we concatenate so a multi-block thinking turn round-trips faithfully.
  // Empty string stays `undefined` on the result so non-Anthropic dialects
  // don't pollute downstream `ChatMessage.reasoning_signature`.
  let reasoningSignature = '';

  // Inline-thinking router: reclassifies `<think>` / `<thinking>` blocks
  // emitted on the *content* channel into the reasoning channel. See
  // `inlineReasoningRouter.ts` for the full rationale — short version:
  // many providers don't separate `reasoning_content` from `content`,
  // and models prompted to think emit chain-of-thought as inline XML
  // wrapped text. Without this routing those tags leak into the
  // rendered timeline as visible XML scaffolding.
  const router = new InlineReasoningRouter();

  // Fires `onReasoningEnd` the first time a post-reasoning content or
  // tool-call delta lands. Split into a helper so the call sites below
  // stay symmetric — if a future delta shape (e.g. structured citations)
  // also counts as "reasoning is done", it only has to call this in one
  // place. Forwards the cumulative Anthropic thinking signature when
  // present — empty string maps to `undefined` so the renderer's
  // `agent-reasoning-end` event omits the field for non-Anthropic turns
  // and stays a clean no-op on the JSONL transcript.
  const maybeCloseReasoning = (): void => {
    if (!hadReasoning || reasoningEndEmitted) return;
    reasoningEndEmitted = true;
    hooks?.onReasoningEnd?.(reasoningSignature.length > 0 ? reasoningSignature : undefined);
  };

  // Funnels a chunk's text portion (post-router) through the same
  // accumulation + hook + reasoning-close path the legacy `contentDelta`
  // branch used. The router can split a single content delta into a
  // text portion and a reasoning portion (e.g. when `</thinking>foo`
  // arrives in one chunk); each portion takes its respective branch.
  const emitTextPortion = (s: string): void => {
    if (s.length === 0) return;
    maybeCloseReasoning();
    assistantText += s;
    hadText = true;
    hooks?.onTextDelta?.(s, assistantText);
  };
  const emitReasoningPortion = (s: string): void => {
    if (s.length === 0) return;
    reasoningText += s;
    hadReasoning = true;
    hooks?.onReasoningDelta?.(s, reasoningText);
  };

  for await (const delta of stream) {
    if (delta.contentDelta) {
      const routed = router.feed(delta.contentDelta);
      // Order matters: reasoning portion first so the reasoning panel
      // appends before any sibling text-end transition fires within
      // the same chunk.
      emitReasoningPortion(routed.reasoning);
      emitTextPortion(routed.text);
    }
    if (delta.reasoningDelta) {
      // Native reasoning channel — bypass the router entirely; the
      // provider has already classified the bytes for us.
      reasoningText += delta.reasoningDelta;
      hadReasoning = true;
      hooks?.onReasoningDelta?.(delta.reasoningDelta, reasoningText);
    }
    if (typeof delta.reasoningSignature === 'string' && delta.reasoningSignature.length > 0) {
      // Anthropic emits the signature once per closing thinking block.
      // Concatenate so a turn with multiple thinking blocks round-trips
      // every signature; the orchestrator treats it as opaque bytes
      // regardless of structure.
      reasoningSignature += delta.reasoningSignature;
    }
    if (delta.toolCallDelta) {
      maybeCloseReasoning();
      const idx = resolveToolCallIndex(
        partialToolCalls,
        delta.toolCallDelta.index ?? 0,
        delta.toolCallDelta.id
      );
      if (!partialToolCalls[idx]) partialToolCalls[idx] = { argumentsBuf: '' };
      const tc = partialToolCalls[idx]!;
      if (delta.toolCallDelta.id !== undefined) tc.id = delta.toolCallDelta.id;
      if (delta.toolCallDelta.name !== undefined) {
        const normalized = normalizeRegisteredToolName(delta.toolCallDelta.name);
        tc.name = normalized ?? delta.toolCallDelta.name.trim();
      }
      // Gemini-only: capture the thoughtSignature on whichever delta
      // carries it. The transport attaches it to the same delta as the
      // call's `name` (Gemini sends complete function-call parts in one
      // chunk). We persist on the partial so later JSON parsing can
      // mint the final `ToolCall` with the signature attached.
      if (typeof delta.toolCallDelta.thoughtSignature === 'string' && delta.toolCallDelta.thoughtSignature.length > 0) {
        tc.thoughtSignature = delta.toolCallDelta.thoughtSignature;
      }
      let bufChanged = false;
      if (delta.toolCallDelta.argumentsDelta !== undefined) {
        tc.argumentsBuf += delta.toolCallDelta.argumentsDelta;
        bufChanged = true;
      }
      // Notify the caller AFTER the buffer is updated so the snapshot
      // is consistent (cumulative buf wins). We fire even on a frame
      // that only carried an id/name with no argument bytes so the
      // renderer can seed the call's row with the tool name the
      // moment it's known — useful when the model emits the tool
      // name in one frame and the args in subsequent frames.
      if (hooks?.onToolCallArgsDelta && (bufChanged || delta.toolCallDelta.name !== undefined || delta.toolCallDelta.id !== undefined)) {
        hooks.onToolCallArgsDelta({
          index: idx,
          id: tc.id,
          name: tc.name,
          argsBuf: tc.argumentsBuf
        });
      }
    }
    if (delta.finishReason) finishReason = delta.finishReason;
    if (delta.anthropicMessageId) anthropicMessageId = delta.anthropicMessageId;
    if (delta.anthropicCacheDiagnostics) {
      anthropicCacheMissReason = delta.anthropicCacheDiagnostics.cacheMissReason;
    }
    if (delta.usage) {
      usage = delta.usage;
      if (anthropicCacheMissReason !== undefined) usageEmittedWithMissReason = true;
      hooks?.onUsage?.(delta.usage, {
        ...(anthropicCacheMissReason !== undefined
          ? { cacheMissReason: anthropicCacheMissReason }
          : {})
      });
    }
  }

  // Drain any held router tail (a partial tag at exact end-of-stream
  // can't possibly complete — route the bytes to whichever channel was
  // active when the stream ended).
  const flushed = router.flush();
  emitReasoningPortion(flushed.reasoning);
  emitTextPortion(flushed.text);

  if (
    usage !== undefined &&
    hooks?.onUsage &&
    anthropicCacheMissReason !== undefined &&
    !usageEmittedWithMissReason
  ) {
    hooks.onUsage(usage, { cacheMissReason: anthropicCacheMissReason });
  }

  return {
    assistantText,
    reasoningText,
    partialToolCalls,
    hadText,
    hadReasoning,
    reasoningEndEmitted,
    ...(reasoningSignature.length > 0 ? { reasoningSignature } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(anthropicMessageId !== undefined ? { anthropicMessageId } : {}),
    ...(anthropicCacheMissReason !== undefined ? { anthropicCacheMissReason } : {})
  };
}
