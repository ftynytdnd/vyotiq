/**
 * Derives a displayable model catalogue from `useProviderStore` for the
 * model picker. Returns:
 *
 *   - `localGroups` / `remoteGroups`: enabled providers split by loopback
 *     hosts, each with filter-matching models.
 *   - `flat`: selectable items in display order (local first, then remote).
 */

import { useMemo } from 'react';
import type { ModelInfo, ProviderConfig } from '@shared/types/provider.js';
import { isLocalProvider } from '@shared/providers/isLocalProvider.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { filterProviderModels } from './modelPickerCatalog.js';

interface ModelOptionGroup {
  provider: ProviderConfig;
  models: ModelInfo[];
}

interface FlatOption {
  providerId: string;
  modelId: string;
  /** Index across all flat options (used for keyboard navigation). */
  index: number;
}

export interface ModelOptions {
  localGroups: ModelOptionGroup[];
  remoteGroups: ModelOptionGroup[];
  /** @deprecated Prefer localGroups + remoteGroups — kept for callers still on flat groups. */
  groups: ModelOptionGroup[];
  flat: FlatOption[];
  totalEnabledProviders: number;
}

function buildGroups(enabled: ProviderConfig[], q: string): ModelOptionGroup[] {
  const sorted = [...enabled].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const groups: ModelOptionGroup[] = [];
  for (const p of sorted) {
    const models = p.models ?? [];
    const matched = filterProviderModels(p, models, q);
    if (q && matched.length === 0) continue;
    groups.push({ provider: p, models: matched });
  }
  return groups;
}

export function useModelOptions(query: string): ModelOptions {
  const providers = useProviderStore((s) => s.providers);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const enabled = providers.filter((p) => p.enabled);
    const localEnabled = enabled.filter((p) => isLocalProvider(p));
    const remoteEnabled = enabled.filter((p) => !isLocalProvider(p));
    const localGroups = buildGroups(localEnabled, q);
    const remoteGroups = buildGroups(remoteEnabled, q);
    const groups = [...localGroups, ...remoteGroups];
    const flat: FlatOption[] = [];
    let cursor = 0;
    for (const g of groups) {
      for (const m of g.models) {
        flat.push({ providerId: g.provider.id, modelId: m.id, index: cursor++ });
      }
    }
    return {
      localGroups,
      remoteGroups,
      groups,
      flat,
      totalEnabledProviders: enabled.length
    };
  }, [providers, query]);
}
