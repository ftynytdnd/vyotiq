import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ProviderWithKey } from '@shared/types/provider.js';

describe('tokenCountRemote vision cache key', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('passes visionTokens into refineRemoteCount cache key', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ input_tokens: 42 })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { refineRemoteCount, getCachedRemoteCount } = await import(
      '@main/providers/tokenCountRemote.js'
    );

    const provider = {
      id: 'anthropic',
      dialect: 'anthropic-native',
      apiKey: 'key',
      baseUrl: 'https://api.anthropic.com'
    } as ProviderWithKey;

    const text = 'x'.repeat(9_000);
    refineRemoteCount(provider, 'claude-sonnet', text, 1_200);
    refineRemoteCount(provider, 'claude-sonnet', text, 2_400);

    await vi.waitFor(() => {
      expect(getCachedRemoteCount('anthropic', 'claude-sonnet', text, 1_200)).toBe(42);
      expect(getCachedRemoteCount('anthropic', 'claude-sonnet', text, 2_400)).toBe(42);
    });
  });
});
