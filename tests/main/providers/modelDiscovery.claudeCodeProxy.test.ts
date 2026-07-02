/**
 * Model discovery for claude-code-proxy (no GET /v1/models).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const proxyPersisted = {
  id: 'p-proxy',
  name: 'Local subscription proxy',
  baseUrl: 'http://127.0.0.1:18765',
  dialect: 'anthropic-native' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'cursor-proxy'
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => proxyPersisted),
  updateProvider: vi.fn(async () => proxyPersisted)
}));

vi.mock('@main/providers/claudeCodeProxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/providers/claudeCodeProxy.js')>();
  return {
    ...actual,
    fetchClaudeCodeProxyModels: vi.fn(async () => [
      { id: 'cursor:composer-2.5', label: 'Composer 2.5' },
      { id: 'cursor:composer-2.5-fast', label: 'Composer 2.5 Fast' }
    ]),
    isClaudeCodeProxyProvider: actual.isClaudeCodeProxyProvider
  };
});

import { discoverModels } from '@main/providers/modelDiscovery';
import { fetchClaudeCodeProxyModels } from '@main/providers/claudeCodeProxy.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discoverModels — claude-code-proxy', () => {
  it('uses proxy CLI discovery instead of GET /v1/models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const models = await discoverModels('p-proxy', true);

    expect(fetchClaudeCodeProxyModels).toHaveBeenCalled();
    expect(models.map((m) => m.id)).toEqual(['cursor:composer-2.5', 'cursor:composer-2.5-fast']);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/v1/models'))).toBe(false);

    fetchSpy.mockRestore();
  });
});
