import { modelIdTail } from '@shared/providers/modelId.js';
import type { ModelInfo, ProviderConfig } from '@shared/types/provider.js';

export function modelPickerKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

/** Keys pinned in Recent / Favorites — omit from provider catalog when not searching. */
export function buildPinnedModelKeys(
  recent: Array<{ providerId: string; model: ModelInfo }>,
  favorites: Array<{ providerId: string; model: ModelInfo }>,
  searching: boolean
): ReadonlySet<string> {
  if (searching) return new Set();
  const out = new Set<string>();
  for (const o of recent) out.add(modelPickerKey(o.providerId, o.model.id));
  for (const o of favorites) out.add(modelPickerKey(o.providerId, o.model.id));
  return out;
}

export function filterCatalogModels(
  models: ModelInfo[],
  providerId: string,
  pinned: ReadonlySet<string>
): ModelInfo[] {
  if (pinned.size === 0) return models;
  return models.filter((m) => !pinned.has(modelPickerKey(providerId, m.id)));
}

export type CatalogProviderGroup = {
  provider: ProviderConfig;
  models: ModelInfo[];
};

/** Apply pinned-key dedupe and drop empty provider groups. */
export function visibleCatalogGroups(
  groups: CatalogProviderGroup[],
  pinned: ReadonlySet<string>
): CatalogProviderGroup[] {
  return groups
    .map((g) => ({
      provider: g.provider,
      models: filterCatalogModels(g.models, g.provider.id, pinned)
    }))
    .filter((g) => g.models.length > 0);
}

export function catalogModelCount(groups: CatalogProviderGroup[]): number {
  return groups.reduce((sum, g) => sum + g.models.length, 0);
}

/** Match model id, tail slug, or provider display name. */
export function providerMatchesQuery(provider: ProviderConfig, q: string): boolean {
  if (!q) return false;
  return provider.name.toLowerCase().includes(q);
}

export function modelMatchesQuery(model: ModelInfo, provider: ProviderConfig, q: string): boolean {
  if (!q) return true;
  if (providerMatchesQuery(provider, q)) return true;
  const id = model.id.toLowerCase();
  const tail = modelIdTail(model.id).toLowerCase();
  return id.includes(q) || tail.includes(q);
}

export function filterProviderModels(
  provider: ProviderConfig,
  models: ModelInfo[],
  q: string
): ModelInfo[] {
  const sorted = [...models].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })
  );
  if (!q) return sorted;
  return sorted.filter((m) => modelMatchesQuery(m, provider, q));
}
