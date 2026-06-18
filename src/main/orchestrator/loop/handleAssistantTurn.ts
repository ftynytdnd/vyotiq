/**
 * Drains a single streaming assistant turn. Reads deltas from `streamChat`
 * and emits them to the renderer via the timeline event bus while
 * accumulating the final message state for the model history.
 *
 * Legacy orchestration XML in assistant text is stripped for display only.
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
import { tokenUsageCountsEqual } from '@shared/token/tokenUsageCountsEqual.js';
import { estimateCacheSavings, OPENROUTER_PLATFORM_FEE_MULTIPLIER } from '@shared/providers/cacheSavings.js';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import type { ChatStreamRequest } from '../../providers/chatClient.js';
import { streamChat } from '../../providers/chatClient.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { consumeChatStream, type PartialToolCall } from './consumeChatStream.js';
import { saveGeneratedImage } from '../../attachments/saveGeneratedImage.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/assistant-turn');

async function logCacheSavings(req: ChatStreamRequest, usage: TokenUsage): Promise<void> {
  try {
    const provider = await getProviderWithKey(req.providerId);
    if (!provider) return;
    const pricing = provider.models?.find((m) => m.id === req.model)?.pricing;
    const fee =
      classifyProviderHost(provider) === 'openrouter' ? OPENROUTER_PLATFORM_FEE_MULTIPLIER : 1;
    const savings = estimateCacheSavings(usage, pricing, fee);
    if (!savings || (savings.grossSavingsUsd <= 0 && savings.netSavingsUsd <= 0)) return;
    log.info('llm turn cache savings', {
      providerId: req.providerId,
      model: req.model,
      grossSavingsUsd: savings.grossSavingsUsd,
      netSavingsUsd: savings.netSavingsUsd
    });
  } catch {
    // best-effort telemetry
  }
}

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
  argsBuf: string
) => void;

export interface HandleAssistantTurnOpts {
  /** Reuse a timeline id on empty-turn retry so the UI stays one row. */
  assistantMsgId?: string;
  workspacePath?: string;
  runId?: string;
}

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
  /** Anthropic `msg_…` id — chain into the next turn for cache diagnostics. */
  anthropicMessageId?: string;
  /** Anthropic cache-diagnostics miss reason when beta is enabled. */
  anthropicCacheMissReason?: string | null;
  error?: unknown;
}

export async function handleAssistantTurn(
  req: ChatStreamRequest,
  emit: (event: TimelineEvent) => void,
  argsDeltaTap?: ArgsDeltaTap,
  turnOpts?: HandleAssistantTurnOpts
): Promise<AssistantTurnResult> {
  const assistantMsgId = turnOpts?.assistantMsgId ?? randomUUID();
  // Mirror state so the caller can still see whether text/reasoning had
  // started streaming when the iterator threw mid-stream. The runLoop
  // reads `hadText || hadReasoning` to decide whether to emit
  // `agent-text-aborted` and clean the renderer's open accumulator.
  let hadText = false;
  let hadReasoning = false;
  let reasoningEffortStamped = false;
  let lastEmittedUsage: TokenUsage | undefined;
  let lastEmittedCacheMissReason: string | null | undefined;

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
        const stampEffort = !reasoningEffortStamped && req.reasoningEffort !== undefined;
        if (stampEffort) reasoningEffortStamped = true;
        emit({
          kind: 'agent-reasoning-delta',
          id: assistantMsgId,
          ts: Date.now(),
          delta,
          ...(stampEffort ? { effort: req.reasoningEffort } : {})
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
      // waiting for the whole turn to settle.
      onUsage: (usage, meta) => {
        const usageUnchanged =
          lastEmittedUsage !== undefined && tokenUsageCountsEqual(lastEmittedUsage, usage);
        const missReason = meta?.cacheMissReason;
        if (
          usageUnchanged &&
          (missReason === undefined || missReason === lastEmittedCacheMissReason)
        ) {
          return;
        }
        lastEmittedUsage = usage;
        if (missReason !== undefined) lastEmittedCacheMissReason = missReason;

        log.info('llm turn usage', {
          providerId: req.providerId,
          model: req.model,
          promptTokens: usage.promptTokens,
          cacheRead: usage.cachedPromptTokens ?? 0,
          cacheWrite: usage.cacheCreationTokens ?? 0,
          cacheMiss: usage.uncachedPromptTokens ?? 0,
          completionTokens: usage.completionTokens,
          ...(missReason !== undefined && missReason !== null
            ? { cacheMissReason: missReason }
            : {})
        });
        void logCacheSavings(req, usage);
        emit({
          kind: 'token-usage',
          id: randomUUID(),
          ts: Date.now(),
          assistantMsgId,
          usage,
          ...(missReason !== undefined ? { cacheMissReason: missReason } : {})
        });
      },
      // Emit a `tool-call-args-delta` per fragment so the renderer
      // can paint a live partial-args preview while the model is
      // still streaming the call. Surrogate `pending:orc:<index>`
      // callId when the provider hasn't yet sent the real id; the
      // matching authoritative `tool-call` event later carries the
      // real id and the renderer reconciles by index.
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
    if (
      turnOpts?.workspacePath &&
      turnOpts?.runId &&
      consumed.generatedImages.length > 0
    ) {
      for (let i = 0; i < consumed.generatedImages.length; i++) {
        const img = consumed.generatedImages[i]!;
        try {
          const saved = await saveGeneratedImage(
            turnOpts.workspacePath,
            turnOpts.runId,
            i,
            img.mime,
            img.base64
          );
          emit({
            kind: 'assistant-image',
            id: randomUUID(),
            ts: Date.now(),
            mime: saved.mime,
            storedPath: saved.storedPath,
            runId: turnOpts.runId
          });
        } catch (err: unknown) {
          log.warn('failed to save generated image', { err });
        }
      }
    }
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
