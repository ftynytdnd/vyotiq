import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hasActivePollSources = vi.fn(() => false);
const listProviders = vi.fn(async () => []);
const fetchProviderAccount = vi.fn();

vi.mock('@main/providers/providerPollSources.js', () => ({
  hasActivePollSources,
  setProviderPollSource: vi.fn(),
  clearProviderPollSources: vi.fn()
}));

vi.mock('@main/providers/providerStore.js', () => ({
  listProviders,
  getProviderWithKey: vi.fn()
}));

vi.mock('@main/providers/fetchProviderAccount.js', () => ({
  fetchProviderAccount
}));

vi.mock('@main/providers/providerAccountStore.js', () => ({
  getAllProviderAccountSnapshots: vi.fn(() => ({})),
  setProviderAccountSnapshot: vi.fn(),
  evictProviderAccountSnapshot: vi.fn()
}));

vi.mock('@main/providers/providerDiscoveryPoller.js', () => ({
  notifyProviderPollSourcesChanged: vi.fn()
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

describe('providerAccountPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hasActivePollSources.mockReturnValue(false);
    listProviders.mockResolvedValue([]);
  });

  afterEach(async () => {
    const { stopProviderAccountPoller } = await import(
      '@main/providers/providerAccountPoller.js'
    );
    stopProviderAccountPoller();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('skips account fetches when no poll sources are active', async () => {
    const { startProviderAccountPoller } = await import(
      '@main/providers/providerAccountPoller.js'
    );

    startProviderAccountPoller();
    await vi.runOnlyPendingTimersAsync();

    expect(listProviders).not.toHaveBeenCalled();
    expect(fetchProviderAccount).not.toHaveBeenCalled();
  });

  it('fetches accounts when a poll source is active', async () => {
    hasActivePollSources.mockReturnValue(true);
    const { startProviderAccountPoller } = await import(
      '@main/providers/providerAccountPoller.js'
    );

    startProviderAccountPoller();
    await vi.runOnlyPendingTimersAsync();

    expect(listProviders).toHaveBeenCalled();
  });

  it('forces a fetch on manual refresh even when idle', async () => {
    const { refreshProviderAccountsNow } = await import(
      '@main/providers/providerAccountPoller.js'
    );

    await refreshProviderAccountsNow();

    expect(listProviders).toHaveBeenCalled();
  });
});
