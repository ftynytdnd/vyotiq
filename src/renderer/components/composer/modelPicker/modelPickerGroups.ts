import type { ModelInfo, ProviderConfig } from '@shared/types/provider.js';

export type PickerModelEntry = {
  providerId: string;
  provider: ProviderConfig;
  model: ModelInfo;
};

/** Group flat picker entries under their provider, preserving first-seen provider order. */
export function groupPickerEntriesByProvider(
  items: PickerModelEntry[]
): Array<{ provider: ProviderConfig; models: ModelInfo[] }> {
  const order: string[] = [];
  const map = new Map<string, { provider: ProviderConfig; models: ModelInfo[] }>();
  for (const item of items) {
    if (!map.has(item.providerId)) {
      order.push(item.providerId);
      map.set(item.providerId, { provider: item.provider, models: [] });
    }
    map.get(item.providerId)!.models.push(item.model);
  }
  return order.map((id) => map.get(id)!);
}

/** Group then sort providers alphabetically by display name. */
export function groupPickerEntriesByProviderSorted(
  items: PickerModelEntry[]
): Array<{ provider: ProviderConfig; models: ModelInfo[] }> {
  return groupPickerEntriesByProvider(items).sort((a, b) =>
    a.provider.name.localeCompare(b.provider.name, undefined, { sensitivity: 'base' })
  );
}
