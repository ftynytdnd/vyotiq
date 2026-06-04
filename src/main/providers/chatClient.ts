/**
 * Raw HTTP streaming chat client. NO SDKs.
 *
 * Acts as a dialect dispatcher: looks up the provider, then delegates
 * to either `streamOpenAi` (SSE, `/v1/chat/completions`) or
 * `streamOllama` (NDJSON, `/api/chat`) based on the persisted
 * `provider.dialect` field. Both implementations yield the same
 * `ChatStreamDelta` shape so callers (`runLoop`, `SubAgent`,
 * `consumeChatStream`, etc.) never branch on dialect themselves.
 *
 * Compatible providers via the OpenAI dialect: OpenAI, DeepSeek, Groq,
 * Together, vLLM, LM Studio, local Ollama's OpenAI shim. Compatible
 * providers via the Ollama-native dialect: Ollama Cloud
 * (`https://ollama.com`) and any Ollama daemon that lacks the OpenAI
 * shim.
 */

import type { ChatMessage, TokenUsage } from '@shared/types/chat.js';
import { getProviderWithKey } from './providerStore.js';
import { streamOpenAi } from './openaiChatStream.js';
import { streamOllama } from './ollamaChatStream.js';
import { streamAnthropic } from './anthropicChatStream.js';
import { streamGemini } from './geminiChatStream.js';

export interface ChatStreamRequest {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  /** Optional OpenAI-compatible function tool schemas. */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Phase 7 (2026) — stable conversation id for provider-side
   * prompt-cache attribution. The xAI Grok 4.x family uses this on
   * the `x-grok-conv-id` request header to maximize cache hit rate
   * across successive turns of the same conversation
   * (`docs.x.ai/developers/advanced-api-usage/prompt-caching`).
   * Other providers ignore the field. Optional so existing callers
   * (and tests) don't need to thread it everywhere — the xAI cache
   * still works without it, just with lower hit rates.
   */
  conversationId?: string;
  /** OpenAI-compat: allow multiple tool calls per assistant turn. */
  parallelToolCalls?: boolean;
  /**
   * Optional callback fired exactly once per request, the moment the
   * HTTP response headers have been received but before any SSE chunk
   * has been parsed. Lets the caller distinguish two distinct waiting
   * windows that look identical to the user otherwise:
   *
   *   1. `connecting`: TLS handshake + request-line + waiting for the
   *      provider to start writing the response (this can dominate on
   *      cold-start serverless providers).
   *   2. `awaiting-response`: connection is open, headers received,
   *      but the model hasn't emitted its first token yet (the actual
   *      "thinking" wait, server-side).
   *
   * The renderer's `LiveStatusRow` surfaces a different label per
   * phase so the user can tell whether the network or the model is
   * the bottleneck. Errors thrown by the callback are swallowed so a
   * misbehaving listener can never abort the stream.
   */
  onConnect?: () => void;
}

export interface ChatStreamDelta {
  /** Incremental assistant text token. */
  contentDelta?: string;
  /**
   * Incremental DeepSeek-style chain-of-thought token. Provider-agnostic:
   * any provider that emits `delta.reasoning_content` will surface here.
   */
  reasoningDelta?: string;
  /**
   * Anthropic-only: terminal signature for the just-closed thinking block.
   * Emitted exactly ONCE per `thinking` content block — at
   * `content_block_stop` — and carries the cumulative bytes accumulated
   * across all preceding `signature_delta` events for that block.
   *
   * The `consumeChatStream` consumer concatenates these onto the
   * `reasoningSignature` result field; the orchestrator then persists
   * the value via `agent-reasoning-end.signature` (transcript) and
   * `assistantMessage.reasoning_signature` (in-memory). Anthropic's API
   * REQUIRES the signature to be passed back unchanged on the next turn
   * for thinking-capable models, otherwise the model loses its plan.
   *
   * Other dialects do not surface a sibling signature on the wire;
   * this field stays `undefined` for them.
   *
   * Source: https://platform.claude.com/docs/en/docs/build-with-claude/streaming
   *         https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
   */
  reasoningSignature?: string;
  /** Incremental tool-call piece. */
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
    /**
     * Gemini-only: opaque thoughtSignature attached to a `functionCall`
     * part. Surfaced on the SAME delta that delivers the call's name
     * (Gemini sends complete function-call parts in one chunk; we emit
     * one synthetic `toolCallDelta` per part). The orchestrator
     * persists it via `ToolCall.thoughtSignature` for round-trip on
     * the next request — Gemini 3 returns 400 when missing on the
     * "Current Turn".
     *
     * Source: https://ai.google.dev/gemini-api/docs/thought-signatures
     */
    thoughtSignature?: string;
  };
  /** Set on the FINAL chunk only. */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error' | string;
  /**
   * Set on the final usage chunk that OpenAI-compat providers emit when
   * `stream_options.include_usage: true` is requested. Arrives as its own
   * SSE frame with an EMPTY `choices` array and a top-level `usage`
   * object. Normalized to camelCase here so nothing downstream speaks the
   * snake_case wire format.
   */
  usage?: TokenUsage;
}

/**
 * Async-generator that yields deltas as they arrive. Caller is
 * responsible for accumulating them. The dispatch shape was chosen
 * over a class so callers can keep using the natural
 * `for await (const d of streamChat(req))` form unchanged.
 */
export async function* streamChat(req: ChatStreamRequest): AsyncGenerator<ChatStreamDelta> {
  const provider = await getProviderWithKey(req.providerId);
  if (!provider) throw new Error(`Provider not found: ${req.providerId}`);

  // Legacy providers persisted before the `dialect` field existed are
  // treated as OpenAI-compat — same behavior as before this refactor.
  const dialect = provider.dialect ?? 'openai';
  if (dialect === 'ollama-native') {
    yield* streamOllama(req, provider);
    return;
  }
  if (dialect === 'anthropic-native') {
    yield* streamAnthropic(req, provider);
    return;
  }
  if (dialect === 'gemini-native') {
    yield* streamGemini(req, provider);
    return;
  }
  yield* streamOpenAi(req, provider);
}
