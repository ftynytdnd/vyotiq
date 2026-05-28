/**
 * Concurrent discoverModels calls share one in-flight HTTP fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/providers/providerStore.js', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p1',
    name: 'Test',
    baseUrl: 'https://api.example.com',
    apiKey: 'k',
    dialect: 'openai' as const,
    models: undefined,
    lastDiscoveredAt: undefined
  })),
  updateProvider: vi.fn(async () => ({}))
}));

import { discoverModels } from '@main/providers/modelDiscovery';

describe('discoverModels in-flight dedupe', () => {
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls += 1;
        await new Promise((r) => setTimeout(r, 40));
        return new Response(
          JSON.stringify({ data: [{ id: 'gpt-test' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('coalesces parallel discoverModels for the same provider', async () => {
    const [a, b, c] = await Promise.all([
      discoverModels('p1', true),
      discoverModels('p1', true),
      discoverModels('p1', true)
    ]);
    expect(fetchCalls).toBe(1);
    expect(a).toEqual([{ id: 'gpt-test' }]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});
