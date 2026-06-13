import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetProviderAccountInFlight,
  fetchProviderAccount
} from '@main/providers/fetchProviderAccount';
import type { ProviderWithKey } from '@shared/types/provider.js';

const provider: ProviderWithKey = {
  id: 'p-ds',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  dialect: 'openai',
  enabled: true,
  apiKey: 'sk-deepseek'
};

beforeEach(() => {
  __test_resetProviderAccountInFlight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchProviderAccount — DeepSeek', () => {
  it('parses /user/balance total_balance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: 'USD', total_balance: '42.50' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const snap = await fetchProviderAccount(provider);
    expect(snap.status).toBe('ok');
    expect(snap.balanceUsd).toBeCloseTo(42.5, 2);
    expect(snap.hostKind).toBe('deepseek');
  });
});
