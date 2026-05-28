/**
 * Drains a single streaming assistant turn. Reads deltas from `streamChat`
 * and emits them to the renderer via the timeline event bus while
 * accumulating the final message state for the model history.
 *
 * Mid-stream delegate detection:
 *   The orchestrator's `<delegate />` directives drive the parallel sub-
 *   agent pool. Until this fix, the host parsed the directives only AFTER
 *   the entire orchestrator turn had streamed — so for a reasoning-heavy
 *   model the user saw seconds of "thinking" with no visible signal that
 *   delegation was about to fire. We now scan the running assistant text
 *   after each text delta, parse any newly-completed `<delegate ...>`
 *   directive (paired or self-closing), and emit a `subagent-pending`
 *   event for each. The reducer materialises a sub-agent row immediately;
 *   the matching `subagent-spawn` later transitions it to `running`.
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
import { parseDelegates } from '../envelope/index.js';

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
  argsDeltaTap?: ArgsDeltaTap,
  /**
   * T0-7: Set of delegate ids the orchestrator has ALREADY emitted
   * `subagent-pending` events for during the current run. When supplied,
   * this turn's mid-stream parser dedupes against it so two assistant
   * turns inside the same iteration (rare — provider returns then
   * continues) cannot emit duplicate `subagent-pending` rows for the
   * same id. Optional for backward compatibility with the per-turn
   * scope every existing caller (sub-agent path, tests) still uses.
   */
  seenDelegateIds: Set<string> = new Set()
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
        // Mid-stream delegate detection. `parseDelegates` is regex-based
        // so it only resolves when a directive is fully closed (`/>` or
        // `</delegate>`); a partial directive at the buffer tail will be
        // ignored until subsequent deltas complete it. New directives
        // produce a `subagent-pending` event with the directive's own
        // attributes; the reducer dedups against later `subagent-spawn`.
        //
        // Trigger gate (perf): `parseDelegates` scans the WHOLE
        // accumulated buffer on every call — for reasoning-heavy turns
        // with thousands of single-token deltas the cost is
        // O(text-size × #deltas). A directive can only have NEWLY
        // closed in this delta if the delta itself contains `>`
        // (closes `<delegate ... />` or `</delegate>`); no `>`, no
        // parse. Audit fix A5: the previous gate also admitted `<`
        // but a `<` without a `>` cannot close a directive in the
        // same delta, so admitting it was pure cost on deltas
        // carrying less-than literals in prose / code.
        if (delta.indexOf('>') === -1) return;
        const directives = parseDelegates(accumulated);
        for (const d of directives) {
          if (seenDelegateIds.has(d.id)) continue;
          seenDelegateIds.add(d.id);
          emit({
            kind: 'subagent-pending',
            id: randomUUID(),
            ts: Date.now(),
            subagentId: d.id,
            task: d.task,
            files: d.files,
            tools: d.tools,
            // Carry the orchestrator's selected provider + model so the
            // renderer's sub-agent row can paint a tiny model badge from
            // the moment the directive is parsed mid-stream. `req` is the
            // outer-scope `ChatStreamRequest` already passed into this
            // handler; both fields are non-optional on the request shape.
            model: { providerId: req.providerId, modelId: req.model }
          });
        }
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
