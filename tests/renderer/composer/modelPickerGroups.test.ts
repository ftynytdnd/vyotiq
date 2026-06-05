import { describe, expect, it } from 'vitest';
import {
  groupPickerEntriesByProvider,
  groupPickerEntriesByProviderSorted
} from '@renderer/components/composer/modelPicker/modelPickerGroups';
import type { ProviderConfig } from '@shared/types/provider.js';

const providerA: ProviderConfig = {
  id: 'a',
  name: 'Alpha',
  baseUrl: 'https://a.example',
  dialect: 'openai',
  enabled: true,
  models: []
};

const providerB: ProviderConfig = {
  id: 'b',
  name: 'Beta',
  baseUrl: 'https://b.example',
  dialect: 'openai',
  enabled: true,
  models: []
};

describe('modelPickerGroups', () => {
  it('groups entries by provider preserving first-seen order', () => {
    const groups = groupPickerEntriesByProvider([
      { providerId: 'b', provider: providerB, model: { id: 'm1' } },
      { providerId: 'a', provider: providerA, model: { id: 'm2' } },
      { providerId: 'b', provider: providerB, model: { id: 'm3' } }
    ]);
    expect(groups.map((g) => g.provider.id)).toEqual(['b', 'a']);
    expect(groups[0]!.models.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('sorts provider groups alphabetically by name', () => {
    const groups = groupPickerEntriesByProviderSorted([
      { providerId: 'b', provider: providerB, model: { id: 'm1' } },
      { providerId: 'a', provider: providerA, model: { id: 'm2' } }
    ]);
    expect(groups.map((g) => g.provider.name)).toEqual(['Alpha', 'Beta']);
  });
});
