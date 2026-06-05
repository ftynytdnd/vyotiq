import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    dialect: 'openai',
    openaiTransport: 'chat-completions',
    enabled: true,
    models: [
      {
        id: 'deepseek-v4-flash',
        thinking: {
          supported: true,
          wireStyle: 'openai-deepseek',
          mapsXhighToMax: true,
          rejectsToolChoice: true,
          defaultOn: true
        }
      }
    ],
    apiKey: 'sk-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

function mockStream(chunks: string[]): void {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    }
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    body
  } as Response);
}

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

describe('streamOpenAi thinking request body', () => {
  it('sends reasoning_effort and DeepSeek thinking block', async () => {
    mockStream(['data: [DONE]\n\n']);
    const fetchMock = vi.mocked(globalThis.fetch);

    const gen = streamChat({
      providerId: 'p',
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'xhigh'
    });
    // drain
    for await (const _ of gen) {
      /* consume */
    }

    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(parsed.reasoning_effort).toBe('max');
    expect(parsed.thinking).toEqual({ type: 'enabled' });
  });
});
