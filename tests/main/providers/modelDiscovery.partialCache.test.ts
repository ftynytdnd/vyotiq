/**
 * TTL cache invalidation when sibling models lack discovery metadata.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const openAiPersisted = vi.hoisted(() => ({
  id: 'p-openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  dialect: 'openai' as const,
  enabled: true,
  models: [] as Array<{
    id: string;
    contextWindow?: number;
    inputModalities?: string[];
  }>,
  lastDiscoveredAt: undefined as number | undefined,
  apiKey: 'sk-test'
}));

const getProviderWithKey = vi.hoisted(() => vi.fn(async () => openAiPersisted));
const updateProvider = vi.hoisted(() =>
  vi.fn(async (_id: string, patch: unknown) => ({
    ...openAiPersisted,
    ...(patch as object)
  }))
);

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey,
  updateProvider
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
  openAiPersisted.models = [];
  openAiPersisted.lastDiscoveredAt = undefined;
});

describe('discoverModels — partial TTL cache metadata', () => {
  it('re-fetches when one chat model has contextWindow and a sibling does not', async () => {
    openAiPersisted.models = [
      { id: 'gpt-4o', contextWindow: 128_000 },
      { id: 'gpt-5.5' }
    ];
    openAiPersisted.lastDiscoveredAt = Date.now();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(200, {
        data: [
          { id: 'gpt-4o', context_window: 128_000 },
          { id: 'gpt-5.5', context_window: 1_050_000 }
        ]
      })
    );

    try {
      const models = await discoverModels('p-openai', false);
      expect(fetchSpy).toHaveBeenCalled();
      expect(models.find((m) => m.id === 'gpt-5.5')?.contextWindow).toBe(1_050_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('skips re-fetch when every chat model has contextWindow and modalities', async () => {
    openAiPersisted.models = [
      { id: 'gpt-4o', contextWindow: 128_000, inputModalities: ['text', 'image'] },
      { id: 'gpt-5.5', contextWindow: 1_050_000, inputModalities: ['text', 'image'] }
    ];
    openAiPersisted.lastDiscoveredAt = Date.now();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const models = await discoverModels('p-openai', false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(models).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
