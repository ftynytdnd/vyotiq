/**
 * NVIDIA Integrate discovery enriches context from the public NGC catalog.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const persisted = {
  id: 'p-nvidia',
  name: 'OpenAI',
  baseUrl: 'https://integrate.api.nvidia.com',
  dialect: 'openai' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'nvapi-test'
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => persisted),
  updateProvider: vi.fn(async () => persisted)
}));

vi.mock('@main/providers/nvidiaNgcCatalog.js', () => ({
  enrichNvidiaModelsContext: vi.fn(async (models: Array<{ id: string; contextWindow?: number }>) =>
    models.map((m) =>
      m.id === 'google/gemma-4-31b-it' ? { ...m, contextWindow: 262_144 } : m
    )
  ),
  loadNvidiaNgcContextCatalog: vi.fn(async () => new Map([['google/gemma-4-31b-it', 262_144]]))
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

describe('discoverModels — NVIDIA Integrate', () => {
  it('enriches context from NGC when /v1/models omits metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(200, {
        data: [{ id: 'google/gemma-4-31b-it', object: 'model', owned_by: 'google' }]
      })
    );

    try {
      const models = await discoverModels('p-nvidia', true);
      expect(models[0]?.id).toBe('google/gemma-4-31b-it');
      expect(models[0]?.contextWindow).toBe(262_144);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
