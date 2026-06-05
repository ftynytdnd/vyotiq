import { describe, expect, it, vi, beforeEach } from 'vitest';

const persisted = {
  id: 'p-deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  dialect: 'openai' as const,
  enabled: true,
  models: [{ id: 'deepseek-v4-flash' }],
  lastDiscoveredAt: Date.now(),
  apiKey: 'sk-test'
};

const updateProviderMock = vi.fn(async () => persisted);

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => persisted),
  updateProvider: (...args: unknown[]) => updateProviderMock(...args)
}));

import { discoverModels } from '@main/providers/modelDiscovery';

beforeEach(() => {
  updateProviderMock.mockClear();
});

describe('discoverModels — DeepSeek host protocol', () => {
  it('applies thinking metadata from the DeepSeek API host when list omits fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      const models = await discoverModels('p-deepseek', true);
      expect(models[0]?.thinking?.supported).toBe(true);
      expect(models[0]?.thinking?.wireStyle).toBe('openai-deepseek');
      expect(models[0]?.contextWindow).toBe(1_000_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
