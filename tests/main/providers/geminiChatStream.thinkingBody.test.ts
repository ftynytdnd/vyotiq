import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'g',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    dialect: 'gemini-native',
    enabled: true,
    models: [
      {
        id: 'gemini-2.5-flash',
        thinking: { supported: true, wireStyle: 'gemini-budget', defaultOn: true }
      }
    ],
    apiKey: 'key'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

describe('streamGemini thinking request body', () => {
  it('includes thinkingConfig on streamGenerateContent', async () => {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n' +
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

    const gen = streamChat({
      providerId: 'g',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'medium'
    });
    for await (const _ of gen) {
      /* drain */
    }

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('streamGenerateContent');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const parsed = JSON.parse(String(init.body)) as {
      generationConfig?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(parsed.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 8192 });
  });
});
