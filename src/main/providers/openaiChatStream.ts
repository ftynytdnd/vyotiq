/**
 * OpenAI-compatible streaming chat transport. POSTs to
 * `${baseUrl}/v1/chat/completions` with `stream: true` and parses
 * Server-Sent Events into `ChatStreamDelta` objects. Compatible with
 * OpenAI, DeepSeek, Ollama (OpenAI shim), LM Studio, vLLM, Groq,
 * Together, etc.
 *
 * This file is called only through `chatClient.streamChat()` — it should
 * NOT be imported directly from anywhere else in the codebase so the
 * dialect-routing policy stays in one place.
 */

import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError, extractOpenAiCompatStreamError, ProviderError, looksRateLimited } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { buildAttributionHeaders, isOpenRouterHost } from './attributionHeaders.js';
import { recordProviderRateLimits } from './providerRateLimitCapture.js';
import { readSseFrames, pickSseDataLine } from './sseFrameReader.js';
import {
  stripGeminiSignatures,
  stripReasoningContentForStrictDialects
} from './sanitizeMessages.js';
import { safeText } from './errorBody.js';
import {
  PRE_HEADER_STREAM_INACTIVITY_MS,
  STREAM_INACTIVITY_TIMEOUT_MS
} from '@shared/constants.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import {
  mapDeepSeekThinking,
  mapOpenAiReasoningEffort,
  mapOpenRouterReasoning,
  openRouterIncludeReasoning,
  resolveStreamerThinkingEffort
} from '@shared/providers/thinkingEffort.js';
import { applyOpenAiCacheHints } from './cacheHints/openaiCacheHints.js';
import { normalizeWireTools } from './normalizeWireTools.js';

const log = logger.child('providers/chat/openai');

/** Reasoning text from OpenAI-compat / OpenRouter / DeepSeek stream deltas. */
function extractReasoningDeltaText(delta: RawSseChoice['delta']): string | null {
  if (!delta) return null;
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    return delta.reasoning_content;
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
    return delta.reasoning;
  }
  if (Array.isArray(delta.reasoning_details)) {
    let text = '';
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string' && detail.text.length > 0) {
        text += detail.text;
      }
    }
    if (text.length > 0) return text;
  }
  return null;
}

interface RawSseChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    /** DeepSeek / OpenRouter reasoning chunk. */
    reasoning_content?: string | null;
    /** OpenRouter unified reasoning text (2026). */
    reasoning?: string | null;
    /** OpenRouter structured reasoning stream (2026). */
    reasoning_details?: Array<{ type?: string; text?: string }>;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface RawSseChunk {
  choices?: RawSseChoice[];
  /**
   * OpenAI-compat final usage frame. `choices` is usually `[]` in that
   * frame — the whole chunk is just the usage report. Some providers
   * (DeepSeek v4-pro, Groq) may instead attach `usage` to the last
   * content chunk, so we always check and emit once regardless of where
   * it lands. Anthropic's `/v1/messages` dialect uses a different event
   * stream entirely and is not handled here.
   *
   * 2026 fields supported across the OpenAI-compat family:
   *
   *   - `prompt_tokens_details.cached_tokens` — OpenAI prompt-cache
   *     hits (gpt-4o+, GPT-5 family). xAI Grok 4.x reports the same.
   *   - `completion_tokens_details.reasoning_tokens` — OpenAI o*,
   *     DeepSeek V4 thinking, xAI Grok reasoning models.
   *   - `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` —
   *     DeepSeek V4 NON-STANDARD top-level fields (verified via
   *     `api-docs.deepseek.com/api/create-chat-completion` and
   *     `api-docs.deepseek.com/guides/kv_cache`, 2026). We
   *     normalize these into `cachedPromptTokens` alongside the
   *     OpenAI nested form so all dialects flow through the same
   *     `TokenUsage` shape downstream.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** OpenAI / xAI canonical: nested details. */
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** DeepSeek V4 non-standard top-level cache fields. */
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  /**
   * OpenAI-compat mid-stream error envelope. The HTTP response was 200
   * and the stream opened, then the provider emits a single
   * `data: {"error":{...}}` frame instead of a content/usage chunk —
   * OpenRouter (upstream provider failure, mid-generation rate limit,
   * moderation), Azure OpenAI, and several gateways (Together, Groq)
   * all surface failures this way. OpenAI's own canonical error object
   * is `{ message, type, code }`; some gateways send a bare string.
   */
  error?: { message?: string; type?: string; code?: string | number; metadata?: unknown } | string;
}

/**
 * Async-generator that yields deltas as they arrive. Caller is responsible for
 * accumulating them.
 */
export async function* streamOpenAi(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  const url = `${provider.baseUrl}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    // Strict-dialect sanitization at the transport edge. Two passes:
    //
    //   1. `stripGeminiSignatures` — drops the Gemini-only
    //      `thoughtSignature` from any persisted assistant tool_calls
    //      (Phase 9, 2026). OpenAI itself drops unknowns silently,
    //      but strict OpenAI-compat providers (some Together / Groq
    //      routes) reject the request.
    //
    //   2. `stripReasoningContentForStrictDialects` — drops the
    //      DeepSeek-only `reasoning_content` field from outbound
    //      assistant messages when the destination is NOT DeepSeek-
    //      direct. Mistral hard-422s the field
    //      (`extra_forbidden: body.messages.N.assistant.reasoning_content`)
    //      and the retry loop spins forever until the conversation
    //      is manually edited. DeepSeek-direct keeps the field
    //      because thinking-mode round-trip requires it.
    //
    // Both passes are identity-preserving on the common path so the
    // orchestrator's `messages[]` reference doesn't fan out unnecessary
    // copies for the (large) majority of conversations that need
    // neither sanitization.
    messages: stripReasoningContentForStrictDialects(
      stripGeminiSignatures(req.messages),
      provider.baseUrl,
      req.model
    ),
    stream: true,
    // Ask the provider to emit a final usage frame so we can surface real
    // prompt/completion/total token counts to the UI. Universal across
    // OpenAI-compat providers. Providers that don't understand the flag
    // ignore it silently — we gracefully degrade to pre-flight BPE
    // estimates.
    stream_options: { include_usage: true }
  };
  applyOpenAiCacheHints(body, provider, {
    modelId: req.model,
    ...(req.workspaceId !== undefined ? { workspaceId: req.workspaceId } : {}),
    ...(req.conversationId !== undefined ? { conversationId: req.conversationId } : {})
  });
  const wireTools = normalizeWireTools(req.tools);
  if (wireTools && wireTools.length > 0) {
    body['tools'] = wireTools;
    // Only forward `tool_choice` when the caller set one. An OMITTED
    // choice (undefined) is deliberate for thinking models — DeepSeek
    // V4 returns HTTP 400 ("Thinking mode does not support this
    // tool_choice") for any forced/required value, and omitting the
    // field falls back to the server default (`auto`), which is what we
    // want. Sending an explicit `'auto'` here previously crashed those
    // models on the very first turn.
    if (req.toolChoice !== undefined) {
      body['tool_choice'] = req.toolChoice;
    }
    if (req.parallelToolCalls === true) {
      body['parallel_tool_calls'] = true;
    }
  } else if (req.toolChoice !== undefined) {
    // Caller set `tool_choice` WITHOUT attaching tools (iteration-cap
    // synthesis uses `toolChoice: 'none'`). The old guard (`tools.length > 0`)
    // silently dropped the field, so synthesis turns had no effect and the
    // model often kept calling tools right up until the iteration cap.
    // `'none'` / `'auto'` / `'required'` are all meaningful
    // without a `tools` array — OpenAI and the major compat providers
    // accept the bare directive. Forward it through verbatim.
    body['tool_choice'] = req.toolChoice;
  }
  if (typeof req.temperature === 'number') body['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') body['max_tokens'] = req.maxTokens;

  // Thinking-effort (2026). Normalized per-model effort → OpenAI-compat
  // `reasoning_effort`. DeepSeek is always-thinking, so an explicit
  // `off` disables it via the `thinking` body block (which also
  // re-enables `tool_choice`); other OpenAI-compat reasoning models
  // simply omit the field when effort is off/unset.
  const effort = resolveStreamerThinkingEffort(provider, req.model, req.reasoningEffort);
  const modelCaps = findProviderModel(provider, req.model)?.thinking;
  if (isOpenRouterHost(provider.baseUrl)) {
    const reasoning = mapOpenRouterReasoning(effort, modelCaps);
    if (reasoning) {
      body['reasoning'] = reasoning;
      if (openRouterIncludeReasoning(effort)) {
        body['include_reasoning'] = true;
      }
    }
  } else {
    const reasoningEffort = mapOpenAiReasoningEffort(effort, modelCaps);
    if (reasoningEffort !== null) body['reasoning_effort'] = reasoningEffort;
    if (modelCaps?.wireStyle === 'openai-deepseek' && effort !== undefined) {
      body['thinking'] = mapDeepSeekThinking(effort);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // Attribution + cache-hint headers — see `attributionHeaders.ts`
    // for the full resolution table. OpenRouter hosts get `HTTP-Referer`
    // + `X-OpenRouter-Title`; xAI hosts get `x-grok-conv-id` when a
    // conversationId is supplied (Phase 7 — 2026). Everywhere else
    // this is a no-op.
    ...buildAttributionHeaders(
      provider,
      req.conversationId !== undefined
        ? { conversationId: req.conversationId }
        : undefined
    )
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  // Inactivity watchdog — wraps the caller's signal so a silent SSE
  // connection can't hang the run forever. The watchdog's combined
  // signal aborts either when (a) the caller's run-scoped signal fires
  // (user Stop) or (b) no bytes arrive within STREAM_INACTIVITY_TIMEOUT_MS.
  // Both branches surface through `fetch`'s reject / `reader.read()`'s
  // throw; the `catch` around the read loop distinguishes them via
  // `isStreamInactivityError` for structured logging.
  const watch = createInactivityWatch(
    req.signal
      ? { parent: req.signal, timeoutMs: PRE_HEADER_STREAM_INACTIVITY_MS }
      : { timeoutMs: PRE_HEADER_STREAM_INACTIVITY_MS }
  );

  // Adaptive rate guard. Sleeps any concurrent caller until a sibling
  // worker's prior 429 cools off — see `providerRateGuard.ts` for the
  // full rationale (concurrent stream thundering herd).
  await acquire(req.providerId, watch.signal);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: watch.signal
    });
  } catch (err: unknown) {
    watch.dispose();
    if (isStreamInactivityError(err)) {
      log.warn('provider stream inactive before headers', { url, providerId: req.providerId });
    }
    throw err;
  }

  recordProviderRateLimits(req.providerId, res.headers);

  if (!res.ok || !res.body) {
    watch.dispose();
    const errBody = res.body ? await safeText(res) : '';
    log.warn('chat completions request failed', {
      status: res.status,
      statusText: res.statusText,
      url
    });
    if (res.status === 429 || res.status >= 500) {
      // Same staggering contract as the Ollama transport: feed the
      // gate so sibling workers don't dog-pile during a cooldown.
      markRateLimited(req.providerId);
    }
    throw classifyProviderError({
      status: res.status,
      statusText: res.statusText,
      url,
      body: errBody,
      surface: 'chat',
      providerId: req.providerId,
      providerName: provider.name
    });
  }

  // Healthy response — clear any cooldown the gate was holding so
  // sibling workers stop waiting immediately.
  markSuccess(req.providerId);

  // Headers received and body is open — fire the connect hook so the
  // caller can flip its UI status from `connecting` to `awaiting-
  // response`. Wrapped in try/catch so a buggy listener can never abort
  // the stream we're about to read.
  if (req.onConnect) {
    try {
      req.onConnect();
    } catch (err) {
      log.warn('onConnect listener threw; continuing to read stream', { err });
    }
  }
  watch.setTimeoutMs(STREAM_INACTIVITY_TIMEOUT_MS);

  // Frame parser. Yields any deltas parsed from a single SSE frame.
  // Returns `true` if the payload was `[DONE]` (caller stops iterating
  // and the shared reader cleanup cancels the body).
  function* parseFrame(frame: string): Generator<ChatStreamDelta, boolean> {
    const payload = pickSseDataLine(frame);
    if (payload === null) return false;
    if (payload === '[DONE]') return true;
    let chunk: RawSseChunk;
    try {
      chunk = JSON.parse(payload) as RawSseChunk;
    } catch {
      return false;
    }
    // Mid-stream error envelope (`data: {"error":{...}}` on an already-
    // 200 connection). Without this branch the frame carried no `usage`
    // and no `choices`, so it fell through to `if (!choice) return false`
    // and was silently dropped — the user saw a stuck spinner that
    // finished with an empty response and no error. Promote it to a
    // `ProviderError` so `runLoop`'s self-correction path engages, with
    // the same rate-limit sniff + gate feed the Ollama transport uses
    // (a mid-generation 429 from OpenRouter/Groq must stagger sibling
    // concurrent streams instead of letting them dog-pile on retry).
    if (chunk.error !== undefined && chunk.error !== null) {
      const errMsg = extractOpenAiCompatStreamError(chunk.error);
      const rateLimited = looksRateLimited(errMsg);
      if (rateLimited) markRateLimited(req.providerId);
      throw new ProviderError({
        kind: rateLimited ? 'rate-limit' : 'server',
        status: 200,
        providerId: req.providerId,
        providerName: provider.name,
        friendlyMessage: rateLimited
          ? `${provider.name}: Rate limit exceeded (mid-stream) — ${errMsg}`
          : `${provider.name}: Mid-stream error — ${errMsg}`,
        surface: 'chat',
        rawBody: payload.slice(0, 1024)
      });
    }
    if (chunk.usage) {
      const u = chunk.usage;
      const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
      const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
      const total =
        typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion;
      // Phase 7 (2026) — normalize cached + reasoning across dialects.
      //
      // Cache hits:
      //   - OpenAI / xAI canonical: `prompt_tokens_details.cached_tokens`.
      //   - DeepSeek V4 non-standard: `prompt_cache_hit_tokens`.
      // We prefer the OpenAI nested form when both are present (a
      // defensive proxy might emit both — the nested form is the
      // canonical contract).
      const cachedFromOpenAi = u.prompt_tokens_details?.cached_tokens;
      const cachedFromDeepSeek = u.prompt_cache_hit_tokens;
      const cachedPromptTokens =
        typeof cachedFromOpenAi === 'number'
          ? cachedFromOpenAi
          : typeof cachedFromDeepSeek === 'number'
            ? cachedFromDeepSeek
            : undefined;
      const uncachedFromDeepSeek = u.prompt_cache_miss_tokens;
      const reasoningTokens = u.completion_tokens_details?.reasoning_tokens;
      yield {
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
          ...(typeof uncachedFromDeepSeek === 'number'
            ? { uncachedPromptTokens: uncachedFromDeepSeek }
            : {}),
          ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {})
        }
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) return false;
    const delta = choice.delta ?? {};
    const reasoningText = extractReasoningDeltaText(delta);
    if (reasoningText) {
      yield { reasoningDelta: reasoningText };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { contentDelta: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const toolCallDelta: ChatStreamDelta['toolCallDelta'] = {
          index: tc.index ?? 0
        };
        if (tc.id !== undefined) toolCallDelta.id = tc.id;
        const toolName = tc.function?.name ?? (tc as { name?: string }).name;
        if (toolName !== undefined) toolCallDelta.name = toolName;
        if (tc.function?.arguments !== undefined) {
          // OpenAI spec types `arguments` as a string (a JSON-encoded
          // payload accumulated across deltas), but several "OpenAI-
          // compatible" backends (some Ollama-shim modes, certain
          // self-hosted gateways) deliver it as a JSON OBJECT instead.
          // Forwarding the object verbatim breaks the downstream
          // accumulator (`argumentsBuf += delta.argumentsDelta` would
          // coerce it to the literal string "[object Object]"), and
          // the model's tool call would silently land at the executor
          // with `args = {}`. Normalize to a string here so the
          // accumulator semantics hold for every dialect.
          const raw = tc.function.arguments as unknown;
          toolCallDelta.argumentsDelta =
            typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
        }
        yield { toolCallDelta };
      }
    }
    if (choice.finish_reason) {
      yield { finishReason: choice.finish_reason };
    }
    return false;
  }

  try {
    // SSE byte → frame loop is now shared with the Anthropic and
    // Gemini transports — see `sseFrameReader.ts`. The helper owns
    // CRLF normalization, EOF flush, and inactivity-watchdog poke;
    // we keep dialect-specific concerns (the `[DONE]` early-return,
    // the JSON shape interpretation) right here so the helper stays
    // dialect-agnostic.
    for await (const frame of readSseFrames({
      body: res.body,
      watch,
      onInactivity: () => {
        log.warn('provider stream inactive mid-read', {
          url,
          providerId: req.providerId
        });
      }
    })) {
      const gen = parseFrame(frame);
      let r = gen.next();
      while (!r.done) {
        yield r.value;
        r = gen.next();
      }
      if (r.value === true) {
        // `[DONE]` — return out of the for-await; the helper's
        // generator-cleanup `finally` cancels the underlying body
        // reader so the HTTP socket closes promptly.
        return;
      }
    }
  } finally {
    // Watchdog disposal MUST stay here (caller-owned). The shared
    // helper handles the body-reader release; we own the watchdog.
    watch.dispose();
  }
}

