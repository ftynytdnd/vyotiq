import { describe, expect, it } from 'vitest';
import {
  formatBalanceAmount,
  formatProviderAccountDetailRows,
  formatProviderAccountLine,
  providerNeedsManagementKey
} from '@renderer/lib/formatProviderAccount';
import type { ProviderAccountSnapshot } from '@shared/types/providerAccount.js';

describe('formatProviderAccount', () => {
  it('formats CNY balance natively', () => {
    const snap: ProviderAccountSnapshot = {
      providerId: 'p1',
      fetchedAt: Date.now(),
      status: 'ok',
      balanceNative: 8.66,
      currency: 'CNY',
      planLabel: 'Pay-as-you-go'
    };
    expect(formatBalanceAmount(snap)).toBe('¥8.66');
    expect(formatProviderAccountLine(snap)).toContain('¥8.66 left');
  });

  it('shows rate limits when balance unavailable', () => {
    const snap: ProviderAccountSnapshot = {
      providerId: 'p1',
      fetchedAt: Date.now(),
      status: 'ok',
      planLabel: 'Groq Cloud',
      limits: { requestsRemaining: 900, requestsLimit: 1000 }
    };
    expect(formatProviderAccountLine(snap)).toContain('900/1000 req');
  });

  it('includes rate-limit reset hint in detail rows', () => {
    const resetAt = Date.now() + 15 * 60_000;
    const snap: ProviderAccountSnapshot = {
      providerId: 'p1',
      fetchedAt: Date.now(),
      status: 'ok',
      limits: { requestsRemaining: 10, requestsLimit: 100, resetAt }
    };
    const row = formatProviderAccountDetailRows(snap).find((r) => r.label === 'Rate limits');
    expect(row?.value).toContain('resets');
  });

  it('detects management key requirement', () => {
    expect(
      providerNeedsManagementKey({
        providerId: 'p1',
        fetchedAt: Date.now(),
        status: 'ok',
        managementKeyRequired: true
      })
    ).toBe(true);
  });
});
