/**
 * Derives a displayable model catalogue from `useProviderStore` for the
 * model picker. Returns:
 *
 *   - `groups`: enabled providers, each with a (possibly empty) list of
 *     filter-matching models. Disabled providers are dropped entirely so
 *     the picker never offers something that won't actually run.
 *   - `flat`: a flat sequence of selectable items in display order. Used
 *     for keyboard navigation (Up/Down/Enter) — disabled rows (e.g. "no
 *     models discovered yet") are excluded so focus skips them.
 *
 * Filter is case-insensitive substring on `model.id`. When the filter
 * eliminates all of a provider's models, the group is omitted.
 */

import { useMemo } from 'react';
import type { ModelInfo, ProviderConfig } from '@shared/types/provider.js';
import { useProviderStore } from '../../../store/useProviderStore.js';

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
  groups: ModelOptionGroup[];
  flat: FlatOption[];
  totalEnabledProviders: number;
}

export function useModelOptions(query: string): ModelOptions {
  const providers = useProviderStore((s) => s.providers);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const enabled = providers.filter((p) => p.enabled);
    const groups: ModelOptionGroup[] = [];
    const flat: FlatOption[] = [];
    let cursor = 0;
    for (const p of enabled) {
      const models = p.models ?? [];
      const matched = q
        ? models.filter((m) => m.id.toLowerCase().includes(q))
        : models;
      // When filtering, hide groups with zero matches entirely.
      if (q && matched.length === 0) continue;
      groups.push({ provider: p, models: matched });
      for (const m of matched) {
        flat.push({ providerId: p.id, modelId: m.id, index: cursor++ });
      }
    }
    return { groups, flat, totalEnabledProviders: enabled.length };
  }, [providers, query]);
}
