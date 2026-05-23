/**
 * Phase 7 (2026) — OpenAI-compat usage normalization.
 *
 * The OpenAI-compat parser must accept and normalize three flavors
 * of the 2026 `usage` shape:
 *
 *   - Canonical OpenAI / xAI Grok: nested
 *     `usage.prompt_tokens_details.cached_tokens` and
 *     `usage.completion_tokens_details.reasoning_tokens`.
 *   - DeepSeek V4 non-standard top-level fields:
 *     `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
 *   - Plain legacy usage: just the three primary counts.
 *
 * All three must end up as the same `TokenUsage` shape downstream
 * (`promptTokens`, `completionTokens`, `totalTokens`, plus the
 * optional `reasoningTokens` / `cachedPromptTokens` when present).
 *
 * Source for the DeepSeek non-standard shape:
 *   - `api-docs.deepseek.com/api/create-chat-completion`
 *   - `api-docs.deepseek.com/guides/kv_cache`
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    dialect: 'openai',
    enabled: true,
    models: [],
    apiKey: 'sk-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function buildBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encode(c));
      controller.close();
    }
  });
}

function mockOpenAiResponse(chunks: string[]): void {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: buildBody(chunks)
  }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
}

/** Format an SSE frame the way real providers emit them: `data: <json>\n\n`. */
function sseFrame(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function collectUsage(): Promise<ChatStreamDelta['usage'] | undefined> {
  let usage: ChatStreamDelta['usage'] | undefined;
  for await (const d of streamChat({ providerId: 'p', model: 'gpt-5', messages: [] })) {
    if (d.usage) usage = d.usage;
  }
  return usage;
}

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

describe('streamOpenAi — usage normalization (Phase 7)', () => {
  it('normalizes canonical OpenAI cached + reasoning fields', async () => {
    mockOpenAiResponse([
      sseFrame({
        choices: [{ index: 0, delta: { content: 'Hi' } }]
      }),
      sseFrame({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      }),
      sseFrame({
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          prompt_tokens_details: { cached_tokens: 800 },
          completion_tokens_details: { reasoning_tokens: 120 }
        }
      }),
      'data: [DONE]\n\n'
    ]);
    const usage = await collectUsage();
    expect(usage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cachedPromptTokens: 800,
      reasoningTokens: 120
    });
  });

  it('normalizes DeepSeek V4 non-standard prompt_cache_hit_tokens', async () => {
    mockOpenAiResponse([
      sseFrame({
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }]
      }),
      sseFrame({
        choices: [],
        usage: {
          prompt_tokens: 1024,
          completion_tokens: 200,
          total_tokens: 1224,
          // Top-level DeepSeek shape, no nested details.
          prompt_cache_hit_tokens: 768,
          prompt_cache_miss_tokens: 256,
          completion_tokens_details: { reasoning_tokens: 60 }
        }
      }),
      'data: [DONE]\n\n'
    ]);
    const usage = await collectUsage();
    expect(usage?.cachedPromptTokens).toBe(768);
    expect(usage?.reasoningTokens).toBe(60);
    expect(usage?.promptTokens).toBe(1024);
    expect(usage?.completionTokens).toBe(200);
  });

  it('prefers OpenAI nested shape when BOTH dialects are present (defensive proxy)', async () => {
    mockOpenAiResponse([
      sseFrame({
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }]
      }),
      sseFrame({
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          prompt_tokens_details: { cached_tokens: 800 },
          prompt_cache_hit_tokens: 999 // would be wrong if we accidentally took DS's field
        }
      }),
      'data: [DONE]\n\n'
    ]);
    const usage = await collectUsage();
    expect(usage?.cachedPromptTokens).toBe(800);
  });

  it('emits cachedPromptTokens / reasoningTokens as undefined when wire is silent', async () => {
    mockOpenAiResponse([
      sseFrame({
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }]
      }),
      sseFrame({
        choices: [],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }
      }),
      'data: [DONE]\n\n'
    ]);
    const usage = await collectUsage();
    expect(usage).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60
    });
    expect(usage?.cachedPromptTokens).toBeUndefined();
    expect(usage?.reasoningTokens).toBeUndefined();
  });

  it('falls back gracefully when the cached/reasoning numbers are missing inside the details blocks', async () => {
    mockOpenAiResponse([
      sseFrame({
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }]
      }),
      sseFrame({
        choices: [],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 5,
          total_tokens: 35,
          // Both detail blocks present but empty — must not blow up.
          prompt_tokens_details: {},
          completion_tokens_details: {}
        }
      }),
      'data: [DONE]\n\n'
    ]);
    const usage = await collectUsage();
    expect(usage?.cachedPromptTokens).toBeUndefined();
    expect(usage?.reasoningTokens).toBeUndefined();
  });
});
