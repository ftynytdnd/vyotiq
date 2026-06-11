import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyOpenAiCacheHints } from '@main/providers/cacheHints/openaiCacheHints';
import type { ProviderWithKey } from '@shared/types/provider';

describe('applyOpenAiCacheHints', () => {
  const openAiProvider: ProviderWithKey = {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    dialect: 'openai',
    enabled: true,
    models: [],
    apiKey: 'sk-test'
  };

  it('sets composite prompt_cache_key when workspace and conversation ids present', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCacheHints(body, openAiProvider, {
      modelId: 'gpt-4o',
      workspaceId: 'ws-1',
      conversationId: 'conv-1'
    });
    expect(body['prompt_cache_key']).toBe('ws-1:conv-1');
  });

  it('sets 24h retention for GPT-5 models on OpenAI host', () => {
    const body: Record<string, unknown> = {};
    applyOpenAiCacheHints(body, openAiProvider, {
      modelId: 'gpt-5.2',
      workspaceId: 'ws',
      conversationId: 'c'
    });
    expect(body['prompt_cache_retention']).toBe('24h');
  });
});

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    dialect: 'openai',
    openaiTransport: 'chat-completions',
    enabled: true,
    models: [],
    apiKey: 'sk-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

describe('streamOpenAi cache hints on wire', () => {
  beforeEach(() => {
    resetRateGuard();
    vi.restoreAllMocks();
  });

  it('includes prompt_cache_key in chat.completions body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      })
    );

    for await (const _ of streamChat({
      providerId: 'p',
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: 'hi' }],
      workspaceId: 'w1',
      conversationId: 'c1'
    })) {
      /* drain */
    }
    expect(capturedBody?.['prompt_cache_key']).toBe('w1:c1');
  });
});
