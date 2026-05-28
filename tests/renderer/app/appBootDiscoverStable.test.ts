/**
 * App.tsx boot discover: `selectEnabledProviderIds` returns a fresh array on
 * every selector run. Without `useShallow`, each `discoverCached` store write
 * (lastDiscoveredAt) re-triggers the effect → React #185.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ProviderConfig } from '@shared/types/provider';
import { selectEnabledProviderIds, useProviderStore } from '@renderer/store/useProviderStore';

function provider(id: string, patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl: 'https://api.example.com',
    enabled: true,
    ...patch
  };
}

function useEnabledIdsForBoot() {
  return useProviderStore(useShallow((s) => selectEnabledProviderIds(s.providers)));
}

beforeEach(() => {
  useProviderStore.setState({
    providers: [provider('a'), provider('b')],
    loading: false,
    error: null
  });
});

describe('App boot discover subscription', () => {
  it('does not re-render when only discovery metadata changes', () => {
    let renderCount = 0;
    const { unmount } = renderHook(() => {
      renderCount++;
      useEnabledIdsForBoot();
    });
    const afterMount = renderCount;

    act(() => {
      useProviderStore.setState({
        providers: useProviderStore.getState().providers.map((p) =>
          p.id === 'a'
            ? {
                ...p,
                lastDiscoveredAt: Date.now(),
                models: [{ id: 'gpt-test', contextWindow: 128_000 }]
              }
            : p
        )
      });
    });

    expect(renderCount).toBe(afterMount);
    unmount();
  });

  it('runs boot discover effect once while discovery updates providers', async () => {
    const discoverCached = vi.fn(async (id: string) => {
      useProviderStore.setState({
        providers: useProviderStore.getState().providers.map((p) =>
          p.id === id
            ? { ...p, lastDiscoveredAt: Date.now(), models: [{ id: 'm', contextWindow: 8_000 }] }
            : p
        )
      });
      return [{ id: 'm', contextWindow: 8_000 }];
    });
    useProviderStore.setState({ discoverCached });

    const effectRuns = { current: 0 };
    renderHook(() => {
      const enabledProviderIds = useEnabledIdsForBoot();
      const discover = useProviderStore((s) => s.discoverCached);
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        effectRuns.current += 1;
        void (async () => {
          for (const id of enabledProviderIds) {
            await discover(id);
          }
        })();
      }, [enabledProviderIds, discover]);
    });

    await act(async () => {
      await vi.waitFor(() => expect(discoverCached).toHaveBeenCalledTimes(2));
    });
    expect(effectRuns.current).toBe(1);
  });
});
