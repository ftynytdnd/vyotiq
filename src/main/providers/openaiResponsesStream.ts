/**
 * OpenAI Responses API streaming transport (2026).
 *
 * POST `${baseUrl}/v1/responses` with `stream: true`. Used for official
 * OpenAI reasoning models when `resolveOpenAiTransport` selects
 * `responses`. Chat Completions remains the fallback for gateways,
 * tool-heavy turns, and explicit `openaiTransport: 'chat-completions'`.
 *
 * Docs: https://developers.openai.com/api/docs/guides/reasoning
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { userContentHasMultimodalParts } from './multimodal/userContentWire.js';
import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError, ProviderError, looksRateLimited } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { buildAttributionHeaders } from './attributionHeaders.js';
import { applyOpenAiCacheHints } from './cacheHints/openaiCacheHints.js';
import { readSseFrames, pickSseDataLine } from './sseFrameReader.js';
import { safeText } from './errorBody.js';
import {
  mapOpenAiResponsesReasoningEffort,
  resolveStreamerThinkingEffort
} from '@shared/providers/thinkingEffort.js';
import { stripGeminiSignatures } from './sanitizeMessages.js';

const log = logger.child('providers/chat/openai-responses');

interface RawResponsesEvent {
  type?: string;
  delta?: string;
  /** Some events nest text under `text` or `summary`. */
  text?: string;
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  error?: { message?: string; type?: string; code?: string | number } | string;
}

/** Whether this request must use Chat Completions instead of Responses. */
export function responsesApiUnsupportedForRequest(req: ChatStreamRequest): boolean {
  if (req.tools && req.tools.length > 0) return true;
  for (const m of req.messages) {
    if (m.role === 'tool') return true;
    if (m.tool_calls && m.tool_calls.length > 0) return true;
    if (m.role === 'user' && userContentHasMultimodalParts(m.content)) return true;
  }
  return false;
}

export function messagesToResponsesInput(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content ?? '';
      if (text.length > 0) out.push({ role: 'user', content: text });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content ?? '';
      if (text.length > 0) out.push({ role: 'assistant', content: text });
      continue;
    }
    if (m.role === 'system') {
      const text = m.content ?? '';
      if (text.length > 0) out.push({ role: 'system', content: text });
    }
  }
  return out;
}

function pickEventDelta(evt: RawResponsesEvent): string | null {
  if (typeof evt.delta === 'string' && evt.delta.length > 0) return evt.delta;
  if (typeof evt.text === 'string' && evt.text.length > 0) return evt.text;
  return null;
}

function isReasoningEventType(type: string | undefined): boolean {
  if (!type) return false;
  return type.includes('reasoning');
}

export async function* streamOpenAiResponses(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  const url = `${provider.baseUrl}/v1/responses`;
  const body: Record<string, unknown> = {
    model: req.model,
    input: messagesToResponsesInput(stripGeminiSignatures(req.messages)),
    stream: true
  };
  applyOpenAiCacheHints(body, provider, {
    modelId: req.model,
    ...(req.workspaceId !== undefined ? { workspaceId: req.workspaceId } : {}),
    ...(req.conversationId !== undefined ? { conversationId: req.conversationId } : {})
  });
  if (typeof req.maxTokens === 'number') body['max_output_tokens'] = req.maxTokens;
  const effort = resolveStreamerThinkingEffort(provider, req.model, req.reasoningEffort);
  const responsesEffort = mapOpenAiResponsesReasoningEffort(effort);
  if (responsesEffort !== null) {
    body['reasoning'] = { effort: responsesEffort };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...buildAttributionHeaders(
      provider,
      req.conversationId !== undefined ? { conversationId: req.conversationId } : undefined
    )
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  const watch = createInactivityWatch(req.signal ? { parent: req.signal } : {});
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
      log.warn('responses stream inactive before headers', { url, providerId: req.providerId });
    }
    throw err;
  }

  if (!res.ok || !res.body) {
    watch.dispose();
    const errBody = res.body ? await safeText(res) : '';
    log.warn('responses request failed', {
      status: res.status,
      statusText: res.statusText,
      url
    });
    if (res.status === 429 || res.status >= 500) {
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

  markSuccess(req.providerId);

  if (req.onConnect) {
    try {
      req.onConnect();
    } catch (err) {
      log.warn('onConnect listener threw; continuing to read stream', { err });
    }
  }

  function* parseFrame(frame: string): Generator<ChatStreamDelta> {
    const payload = pickSseDataLine(frame);
    if (payload === null || payload === '[DONE]') return;
    let evt: RawResponsesEvent;
    try {
      evt = JSON.parse(payload) as RawResponsesEvent;
    } catch {
      return;
    }
    if (evt.error !== undefined && evt.error !== null) {
      const errMsg =
        typeof evt.error === 'string'
          ? evt.error
          : typeof evt.error.message === 'string'
            ? evt.error.message
            : 'Unknown mid-stream error from provider.';
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
    const usage = evt.response?.usage;
    if (usage) {
      const prompt =
        typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      const completion =
        typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
      const total =
        typeof usage.total_tokens === 'number' ? usage.total_tokens : prompt + completion;
      const cached = usage.input_tokens_details?.cached_tokens;
      const reasoning = usage.output_tokens_details?.reasoning_tokens;
      yield {
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          ...(typeof cached === 'number' ? { cachedPromptTokens: cached } : {}),
          ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {})
        }
      };
    }
    const delta = pickEventDelta(evt);
    if (!delta) return;
    if (isReasoningEventType(evt.type)) {
      yield { reasoningDelta: delta };
      return;
    }
    if (evt.type?.includes('output_text') || evt.type?.includes('message') || !evt.type) {
      yield { contentDelta: delta };
    }
  }

  try {
    for await (const frame of readSseFrames({
      body: res.body,
      watch,
      onInactivity: () => {
        log.warn('responses stream inactive mid-read', { url, providerId: req.providerId });
      }
    })) {
      yield* parseFrame(frame);
    }
    yield { finishReason: 'stop' };
  } finally {
    watch.dispose();
  }
}
