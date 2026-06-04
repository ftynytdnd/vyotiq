/**
 * Drains a single streaming assistant turn. Reads deltas from `streamChat`
 * and emits them to the renderer via the timeline event bus while
 * accumulating the final message state for the model history.
 *
 * Delegation is tool-only (`delegate` tool calls handled in `runLoop` /
 * `handleDelegates`). Mid-stream XML `<delegate />` parsing is intentionally
 * not performed here — orphan pending rows cannot execute without a tool call.
 *
 * Returns:
 *   - `assistantText`     accumulated text content
 *   - `reasoningText`     accumulated DeepSeek-style reasoning
 *   - `partialToolCalls`  tool calls assembled from streaming pieces
 *   - `finishReason`      provider-reported reason ('stop', 'tool_calls', …)
 *   - `assistantMsgId`    the timeline id used for this turn (renderer key)
 *
 * On a streaming error, returns `{ error }` so the caller can decide
 * whether to retry with backoff or escalate.
 */

import { randomUUID } from 'node:crypto';
import type { TimelineEvent, TokenUsage } from '@shared/types/chat.js';
import type { ChatStreamRequest } from '../../providers/chatClient.js';
import { streamChat } from '../../providers/chatClient.js';
import { consumeChatStream, type PartialToolCall } from './consumeChatStream.js';

export type { PartialToolCall };

/**
 * Optional tap that runs before the timeline `tool-call-args-delta`
 * event is emitted. Used by the Phase 2 diff streamer to pipe the
 * cumulative `argsBuf` through a long-lived `PartialJsonParser` and
 * feed the resulting parsed snapshot into the streamer for FS-aware
 * diff computation. Lives at the call site (`runLoop.ts`) so the
 * streamer's lifecycle is bound to the run, not to one assistant
 * turn.
 */
export type ArgsDeltaTap = (
  callId: string,
  name: string | undefined,
  argsBuf: string,
  subagentId?: string
) => void;

export interface AssistantTurnResult {
  assistantMsgId: string;
  assistantText: string;
  reasoningText: string;
  partialToolCalls: PartialToolCall[];
  hadText: boolean;
  hadReasoning: boolean;
  /**
   * True iff `agent-reasoning-end` has already been emitted mid-stream
   * (because the reasoning → content/tool-call transition landed before
   * the turn finished). Tells the caller to skip its own closing
   * `agent-reasoning-end` emission so we don't overwrite the real
   * reasoning-end timestamp with a much later turn-end one.
   */
  reasoningEndEmitted: boolean;
  /**
   * Phase 8 (2026): Anthropic thinking signature accumulated across the
   * turn's `signature_delta` SSE events. Forwarded by the runLoop into
   * the assistant `ChatMessage.reasoning_signature` slot AND the
   * fallback `agent-reasoning-end.signature` event. Empty / undefined
   * for non-Anthropic dialects.
   */
  reasoningSignature?: string;
  finishReason?: string;
  /** Provider-reported token usage for this turn (when available). */
  usage?: TokenUsage;
  error?: unknown;
}

export async function handleAssistantTurn(
  req: ChatStreamRequest,
  emit: (event: TimelineEvent) => void,
  argsDeltaTap?: ArgsDeltaTap
): Promise<AssistantTurnResult> {
  const assistantMsgId = randomUUID();
  // Mirror state so the caller can still see whether text/reasoning had
  // started streaming when the iterator threw mid-stream. The runLoop
  // reads `hadText || hadReasoning` to decide whether to emit
  // `agent-text-aborted` and clean the renderer's open accumulator.
  let hadText = false;
  let hadReasoning = false;

  try {
    const stream = streamChat(req);
    const consumed = await consumeChatStream(stream, {
      onTextDelta: (delta, accumulated) => {
        hadText = accumulated.length > 0;
        emit({
          kind: 'agent-text-delta',
          id: assistantMsgId,
          ts: Date.now(),
          delta
        });
      },
      onReasoningDelta: (delta, accumulated) => {
        hadReasoning = accumulated.length > 0;
        emit({
          kind: 'agent-reasoning-delta',
          id: assistantMsgId,
          ts: Date.now(),
          delta
        });
      },
      // Fires the instant the stream transitions from reasoning_content
      // to content / tool_calls. Emitting `agent-reasoning-end` here —
      // rather than at end-of-turn — lets the renderer's reasoning panel
      // collapse the moment reasoning is truly done, instead of waiting
      // for the full text + tool-call tail to finish streaming.
      // The Anthropic thinking signature, when present, rides this
      // event so the JSONL transcript can replay it onto the matching
      // assistant message's `reasoning_signature` slot — required for
      // multi-turn coherence on Claude thinking-capable models.
      onReasoningEnd: (signature) => {
        emit({
          kind: 'agent-reasoning-end',
          id: assistantMsgId,
          ts: Date.now(),
          ...(signature !== undefined ? { signature } : {})
        });
      },
      // Emit a `token-usage` timeline event as soon as the final usage
      // frame arrives so the composer's usage pill can update without
      // waiting for the whole turn to settle. No `subagentId` here —
      // this is the orchestrator's own turn.
      onUsage: (usage) => {
        emit({
          kind: 'token-usage',
          id: randomUUID(),
          ts: Date.now(),
          assistantMsgId,
          usage
        });
      },
      // Emit a `tool-call-args-delta` per fragment so the renderer
      // can paint a live partial-args preview while the model is
      // still streaming the call. Surrogate `pending:orc:<index>`
      // callId when the provider hasn't yet sent the real id; the
      // matching authoritative `tool-call` event later carries the
      // real id and the renderer reconciles by index+subagentId.
      onToolCallArgsDelta: (snapshot) => {
        const callId = snapshot.id ?? `pending:orc:${snapshot.index}`;
        // Phase 2 — tap the cumulative argsBuf into the run-level
        // diff streamer BEFORE the timeline event so the streamer
        // has a chance to emit a `diff-stream` event that the
        // renderer can pair with the same callId. The tap is a
        // no-op when the run isn't wired with a streamer (tests,
        // future callers).
        argsDeltaTap?.(callId, snapshot.name, snapshot.argsBuf);
        emit({
          kind: 'tool-call-args-delta',
          id: randomUUID(),
          ts: Date.now(),
          callId,
          ...(snapshot.name !== undefined ? { name: snapshot.name } : {}),
          index: snapshot.index,
          argsBuf: snapshot.argsBuf
        });
      }
    });
    // Closing markers are emitted by the caller once it knows whether the
    // text/reasoning is final or aborted.
    return { assistantMsgId, ...consumed };
  } catch (err: unknown) {
    // Mid-stream failure: return whatever the hooks observed before the
    // throw so the caller can drop the open renderer accumulator with an
    // `agent-text-aborted` marker. The actual content/reasoning text and
    // partial tool-call buffers aren't recoverable from outside the
    // helper, but the `had*` booleans are sufficient for that cleanup.
    return {
      assistantMsgId,
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText,
      hadReasoning,
      reasoningEndEmitted: false,
      error: err
    };
  }
}
