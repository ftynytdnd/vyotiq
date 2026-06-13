/**
 * OpenAI-dialect `/v1/models` extended context fields and host fallbacks.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const openAiPersisted = {
  id: 'p-openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  dialect: 'openai' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'sk-test'
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => openAiPersisted),
  updateProvider: vi.fn(async () => openAiPersisted)
}));

import { discoverModels } from '@main/providers/modelDiscovery';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discoverModels — OpenAI-compat context fields', () => {
  it('parses vLLM max_model_len from /v1/models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(200, {
        data: [{ id: 'meta-llama/Llama-3.1-8B-Instruct', max_model_len: 32768 }]
      })
    );

    try {
      const models = await discoverModels('p-openai', true);
      expect(models[0]?.contextWindow).toBe(32768);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('applies host context fallback when OpenAI list omits metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(200, {
        data: [{ id: 'gpt-5.5' }, { id: 'gpt-4o' }]
      })
    );

    try {
      const models = await discoverModels('p-openai', true);
      const gpt55 = models.find((m) => m.id === 'gpt-5.5');
      const gpt4o = models.find((m) => m.id === 'gpt-4o');
      expect(gpt55?.contextWindow).toBe(1_050_000);
      expect(gpt4o?.contextWindow).toBe(128_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
