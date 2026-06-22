/**
 * `providerStore.load()` runs a one-time on-disk migration write when it
 * normalizes legacy records (missing `maxConcurrentStreams`, stale
 * base-URL, legacy thinking map). That write is best-effort: a failure
 * (disk full, OneDrive lock, keychain flap) must NOT reject all of
 * `load()` — the in-memory cache is already authoritative and the
 * migration simply defers to the next boot. These tests pin that
 * graceful-degradation contract.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

let store: unknown[] = [];
let writeShouldThrow = false;
let writeCalls = 0;
const logWarn = vi.fn();

vi.mock('@main/secrets/safeStore', () => ({
  readEncryptedJson: vi.fn(async () => store),
  writeEncryptedJson: vi.fn(async (_file: string, list: unknown[]) => {
    writeCalls += 1;
    if (writeShouldThrow) throw new Error('disk full');
    store = list;
  })
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: {
    child: () => ({ warn: logWarn, debug: vi.fn(), error: vi.fn(), info: vi.fn() })
  }
}));

beforeEach(() => {
  vi.resetModules();
  writeShouldThrow = false;
  writeCalls = 0;
  logWarn.mockClear();
  // A legacy record missing `maxConcurrentStreams` forces the migration
  // write branch (`needsConcurrency`) on the next load.
  store = [
    {
      id: 'p1',
      name: 'Legacy',
      baseUrl: 'https://api.openai.com',
      dialect: 'openai',
      apiKey: 'sk-test',
      enabled: true,
      models: []
    }
  ];
});

describe('providerStore — migration write resilience', () => {
  it('still returns the migrated list when the migration write fails', async () => {
    writeShouldThrow = true;
    const { listProviders } = await import('@main/providers/providerStore');

    const list = await listProviders();

    expect(list).toHaveLength(1);
    // In-memory migration applied even though the disk write threw.
    expect(list[0]!.maxConcurrentStreams).toBeGreaterThan(0);
    // Attempted exactly once, threw, and was swallowed with a breadcrumb.
    expect(writeCalls).toBe(1);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('persists the migration and stays silent when the write succeeds', async () => {
    const { listProviders } = await import('@main/providers/providerStore');

    await listProviders();

    expect(writeCalls).toBe(1);
    expect((store[0] as { maxConcurrentStreams?: number }).maxConcurrentStreams).toBeGreaterThan(0);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('does not write (or warn) when records are already normalized', async () => {
    store = [
      {
        id: 'p1',
        name: 'Modern',
        baseUrl: 'https://api.openai.com',
        dialect: 'openai',
        apiKey: 'sk-test',
        enabled: true,
        models: [],
        maxConcurrentStreams: 8
      }
    ];
    const { listProviders } = await import('@main/providers/providerStore');

    await listProviders();

    expect(writeCalls).toBe(0);
    expect(logWarn).not.toHaveBeenCalled();
  });
});
