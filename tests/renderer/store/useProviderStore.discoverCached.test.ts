import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderStore } from '@renderer/store/useProviderStore';
import type { ProviderConfig } from '@shared/types/provider';

function provider(id: string, patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl: 'https://api.example.com',
    enabled: true,
    ...patch
  };
}

describe('useProviderStore.discoverCached', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        provider('p1', {
          models: [{ id: 'm1', contextWindow: 128_000 }],
          lastDiscoveredAt: 1_700_000_000_000
        })
      ],
      loading: false,
      error: null
    });
    window.vyotiq.providers.discoverModels = vi.fn(async () => ({
      models: [{ id: 'm1', contextWindow: 128_000 }],
      lastDiscoveredAt: 1_700_000_000_000
    })) as never;
  });

  it('mirrors main-process lastDiscoveredAt instead of bumping Date.now()', async () => {
    await useProviderStore.getState().discoverCached('p1');
    const updated = useProviderStore.getState().providers.find((p) => p.id === 'p1');
    expect(updated?.lastDiscoveredAt).toBe(1_700_000_000_000);
  });
});
