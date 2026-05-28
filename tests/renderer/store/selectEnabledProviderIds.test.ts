/**
 * App.tsx boot discover depends on `selectEnabledProviderIds` only — not
 * `lastDiscoveredAt`. Stable ids let the effect finish once per provider per
 * boot while main `discoverInFlight` dedupes concurrent IPC (see
 * tests/main/providers/modelDiscovery.dedupe.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { selectEnabledProviderIds } from '@renderer/store/useProviderStore';
import type { ProviderConfig } from '@shared/types/provider';

function provider(
  id: string,
  enabled = true,
  patch: Partial<ProviderConfig> = {}
): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl: 'https://api.example.com',
    enabled,
    ...patch
  };
}

describe('selectEnabledProviderIds', () => {
  it('is unchanged when only discovery metadata mutates', () => {
    const base = [provider('a'), provider('b'), provider('off', false)];
    const before = selectEnabledProviderIds(base);
    const after = selectEnabledProviderIds(
      base.map((p) =>
        p.id === 'a'
          ? {
              ...p,
              lastDiscoveredAt: Date.now(),
              models: [{ id: 'gpt-test', contextWindow: 128_000 }]
            }
          : p
      )
    );
    expect(before).toEqual(['a', 'b']);
    expect(after).toEqual(before);
  });

  it('reflects enabled membership changes', () => {
    const base = [provider('a'), provider('b')];
    const toggled = selectEnabledProviderIds(
      base.map((p) => (p.id === 'b' ? { ...p, enabled: false } : p))
    );
    expect(toggled).toEqual(['a']);
  });
});
