import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hasActivePollSources = vi.fn(() => false);
const listProviders = vi.fn(async () => []);

vi.mock('@main/providers/providerPollSources.js', () => ({
  hasActivePollSources
}));

vi.mock('@main/providers/providerStore.js', () => ({
  listProviders,
  getProviderWithKey: vi.fn()
}));

vi.mock('@main/providers/modelDiscovery.js', () => ({
  discoverModels: vi.fn(),
  refreshProviderModelsMetadata: vi.fn()
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

describe('providerDiscoveryPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hasActivePollSources.mockReturnValue(false);
    listProviders.mockResolvedValue([]);
  });

  afterEach(async () => {
    const { stopProviderDiscoveryPoller } = await import(
      '@main/providers/providerDiscoveryPoller.js'
    );
    stopProviderDiscoveryPoller();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('keeps polling on the idle interval when no poll sources are active', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { startProviderDiscoveryPoller } = await import(
      '@main/providers/providerDiscoveryPoller.js'
    );

    startProviderDiscoveryPoller();

    expect(setIntervalSpy).toHaveBeenCalled();
    expect(hasActivePollSources()).toBe(false);

    setIntervalSpy.mockRestore();
  });
});
