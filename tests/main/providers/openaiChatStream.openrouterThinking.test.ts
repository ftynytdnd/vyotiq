import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p-or',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    dialect: 'openai',
    openaiTransport: 'chat-completions',
    enabled: true,
    models: [],
    apiKey: 'sk-or-test'
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

describe('streamOpenAi OpenRouter thinking', () => {
  it('sends nested reasoning object and include_reasoning', async () => {
    mockStream(['data: [DONE]\n\n']);
    const fetchMock = vi.mocked(globalThis.fetch);

    const gen = streamChat({
      providerId: 'p-or',
      model: 'deepseek-ai/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'high'
    });
    for await (const _ of gen) {
      /* drain */
    }

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(parsed.reasoning).toEqual({ effort: 'high', exclude: false });
    expect(parsed.include_reasoning).toBe(true);
    expect(parsed.reasoning_effort).toBeUndefined();
  });

  it('parses OpenRouter reasoning_details deltas', async () => {
    mockStream([
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"think"}]}}]}\n\n',
      'data: [DONE]\n\n'
    ]);

    const gen = streamChat({
      providerId: 'p-or',
      model: 'anthropic/claude-sonnet-4',
      messages: [{ role: 'user', content: 'hi' }]
    });
    const deltas: string[] = [];
    for await (const d of gen) {
      if (d.reasoningDelta) deltas.push(d.reasoningDelta);
    }
    expect(deltas.join('')).toBe('think');
  });
});
