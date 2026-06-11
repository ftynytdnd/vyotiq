import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    dialect: 'openai',
    openaiTransport: 'auto',
    enabled: true,
    models: [
      {
        id: 'gpt-5.3',
        thinking: { supported: true, wireStyle: 'openai-reasoning' }
      }
    ],
    apiKey: 'sk-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

describe('streamOpenAiResponses', () => {
  it('posts to /v1/responses with reasoning.effort for gpt-5 on api.openai.com', async () => {
    const sse =
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
      'data: [DONE]\n\n';
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      }
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body
    } as Response);

    let content = '';
    for await (const d of streamChat({
      providerId: 'p',
      model: 'gpt-5.3',
      messages: [{ role: 'user', content: 'hello' }],
      reasoningEffort: 'high'
    })) {
      if (d.contentDelta) content += d.contentDelta;
    }

    expect(content).toBe('Hi');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/v1/responses');
    const parsed = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      reasoning?: { effort?: string };
      stream?: boolean;
    };
    expect(parsed.stream).toBe(true);
    expect(parsed.reasoning).toEqual({ effort: 'high' });
  });

  it('includes prompt_cache_key on responses body when workspace and conversation ids set', async () => {
    const sse =
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
      'data: [DONE]\n\n';
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      }
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body
    } as Response);

    for await (const _ of streamChat({
      providerId: 'p',
      model: 'gpt-5.3',
      messages: [{ role: 'user', content: 'hello' }],
      workspaceId: 'ws-9',
      conversationId: 'conv-9'
    })) {
      /* drain */
    }

    const parsed = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      prompt_cache_key?: string;
      prompt_cache_retention?: string;
    };
    expect(parsed.prompt_cache_key).toBe('ws-9:conv-9');
    expect(parsed.prompt_cache_retention).toBe('24h');
  });

  it('normalizes input_tokens_details.cached_tokens into cachedPromptTokens', async () => {
    const sse =
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":2048,"output_tokens":64,"total_tokens":2112,"input_tokens_details":{"cached_tokens":1536},"output_tokens_details":{"reasoning_tokens":12}}}}\n\n' +
      'data: [DONE]\n\n';
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse));
        c.close();
      }
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body
    } as Response);

    let usage: { cachedPromptTokens?: number; promptTokens?: number } | undefined;
    for await (const d of streamChat({
      providerId: 'p',
      model: 'gpt-5.3',
      messages: [{ role: 'user', content: 'hello' }]
    })) {
      if (d.usage) usage = d.usage;
    }

    expect(usage?.promptTokens).toBe(2048);
    expect(usage?.cachedPromptTokens).toBe(1536);
  });
});
