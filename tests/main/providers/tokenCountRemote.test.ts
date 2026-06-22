import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ProviderWithKey } from '@shared/types/provider.js';

const messages: ChatMessage[] = [
  { role: 'system', content: 'Harness' },
  { role: 'user', content: 'x'.repeat(9_000) }
];

describe('tokenCountRemote wire-shaped payloads', () => {
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

    refineRemoteCount(provider, 'claude-sonnet', messages, [], 1_200);
    refineRemoteCount(provider, 'claude-sonnet', messages, [], 2_400);

    await vi.waitFor(() => {
      expect(getCachedRemoteCount('anthropic', 'claude-sonnet', messages, [], 1_200)).toBe(42);
      expect(getCachedRemoteCount('anthropic', 'claude-sonnet', messages, [], 2_400)).toBe(42);
    });
  });

  it('sends Anthropic count_tokens a structured body with system + messages', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ input_tokens: 100 })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { refineRemoteCount } = await import('@main/providers/tokenCountRemote.js');
    const provider = {
      id: 'anthropic',
      dialect: 'anthropic-native',
      apiKey: 'key',
      baseUrl: 'https://api.anthropic.com'
    } as ProviderWithKey;

    refineRemoteCount(provider, 'claude-sonnet', messages, []);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      system?: string;
      messages?: unknown[];
    };
    expect(body.system).toBe('Harness');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages?.length).toBeGreaterThan(0);
  });
});
