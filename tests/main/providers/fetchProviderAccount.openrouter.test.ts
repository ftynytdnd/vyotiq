import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetProviderAccountInFlight,
  fetchProviderAccount
} from '@main/providers/fetchProviderAccount';
import type { ProviderWithKey } from '@shared/types/provider.js';

const provider: ProviderWithKey = {
  id: 'p-or',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api',
  dialect: 'openai',
  enabled: true,
  apiKey: 'sk-or-inference'
};

beforeEach(() => {
  __test_resetProviderAccountInFlight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchProviderAccount — OpenRouter', () => {
  it('sets managementKeyRequired when /v1/credits returns 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/v1/key')) {
        return new Response(
          JSON.stringify({
            data: {
              label: 'main',
              limit_remaining: 12.5,
              usage_daily: 0.1,
              is_free_tier: false
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/credits')) {
        return new Response('forbidden', { status: 403 });
      }
      return new Response('not found', { status: 404 });
    });

    const snap = await fetchProviderAccount(provider);
    expect(snap.managementKeyRequired).toBe(true);
    expect(snap.balanceUsd).toBe(12.5);
    expect(snap.message).toContain('Management key');
  });
});
