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
});
