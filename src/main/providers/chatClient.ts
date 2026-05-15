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
  /** Incremental tool-call piece. */
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
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
  yield* streamOpenAi(req, provider);
}
