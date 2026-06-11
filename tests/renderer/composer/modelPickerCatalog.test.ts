import { describe, expect, it } from 'vitest';
import {
  buildPinnedModelKeys,
  catalogModelCount,
  filterCatalogModels,
  filterProviderModels,
  modelMatchesQuery,
  modelPickerKey,
  providerMatchesQuery,
  visibleCatalogGroups
} from '@renderer/components/composer/modelPicker/modelPickerCatalog';
import type { ProviderConfig } from '@shared/types/provider.js';

const provider: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama Cloud',
  baseUrl: 'https://ollama.com',
  dialect: 'ollama-native',
  enabled: true,
  models: [
    { id: 'deepseek-v4-flash', contextWindow: 1_048_576 },
    { id: 'gemma4:31b', contextWindow: 32_768 }
  ]
};

describe('modelPickerCatalog', () => {
  it('builds pinned keys from recent and favorites when not searching', () => {
    const pinned = buildPinnedModelKeys(
      [{ providerId: 'p1', model: { id: 'm1' } }],
      [{ providerId: 'p2', model: { id: 'm2' } }],
      false
    );
    expect(pinned.has(modelPickerKey('p1', 'm1'))).toBe(true);
    expect(pinned.has(modelPickerKey('p2', 'm2'))).toBe(true);
  });

  it('returns empty pinned set while searching', () => {
    const pinned = buildPinnedModelKeys(
      [{ providerId: 'p1', model: { id: 'm1' } }],
      [],
      true
    );
    expect(pinned.size).toBe(0);
  });

  it('filters catalog models that are pinned elsewhere', () => {
    const pinned = new Set([modelPickerKey('p1', 'm1')]);
    const out = filterCatalogModels([{ id: 'm1' }, { id: 'm2' }], 'p1', pinned);
    expect(out.map((m) => m.id)).toEqual(['m2']);
  });

  it('visibleCatalogGroups drops empty provider groups after pin filter', () => {
    const pinned = new Set([modelPickerKey('ollama', 'deepseek-v4-flash')]);
    const out = visibleCatalogGroups([{ provider, models: provider.models ?? [] }], pinned);
    expect(out[0]?.models.map((m) => m.id)).toEqual(['gemma4:31b']);
  });

  it('catalogModelCount sums visible models', () => {
    expect(
      catalogModelCount([{ provider, models: provider.models ?? [] }])
    ).toBe(2);
  });

  it('matches provider name in search', () => {
    expect(providerMatchesQuery(provider, 'ollama')).toBe(true);
    expect(modelMatchesQuery({ id: 'other' }, provider, 'ollama')).toBe(true);
  });

  it('filterProviderModels returns all models when provider name matches', () => {
    const out = filterProviderModels(provider, provider.models ?? [], 'ollama');
    expect(out).toHaveLength(2);
  });

  it('filterProviderModels matches model tail slug', () => {
    const out = filterProviderModels(provider, provider.models ?? [], 'gemma4');
    expect(out.map((m) => m.id)).toEqual(['gemma4:31b']);
  });
});
