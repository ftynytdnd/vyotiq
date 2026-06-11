import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetProviderAccountInFlight,
  fetchProviderAccount
} from '@main/providers/fetchProviderAccount';
import type { ProviderWithKey } from '@shared/types/provider.js';

const provider: ProviderWithKey = {
  id: 'p-xai',
  name: 'xAI',
  baseUrl: 'https://api.x.ai',
  dialect: 'openai',
  enabled: true,
  apiKey: 'xai-inference-key',
  billingApiKey: 'xai-mgmt-key'
};

beforeEach(() => {
  __test_resetProviderAccountInFlight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchProviderAccount — xAI Management API', () => {
  it('reads prepaid balance via management key validation + balance endpoints', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/management-keys/validation')) {
        return new Response(JSON.stringify({ teamId: 'team-abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/prepaid/balance')) {
        return new Response(JSON.stringify({ total: { val: '2500' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/postpaid/invoice/preview')) {
        return new Response(
          JSON.stringify({
            coreInvoice: { prepaidCreditsUsed: { val: '150' } }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });

    const snap = await fetchProviderAccount(provider);
    expect(snap.balanceUsd).toBe(25);
    expect(snap.balanceAvailable).toBe(true);
    expect(snap.usage?.monthly?.spendUsd).toBe(1.5);
  });
});
