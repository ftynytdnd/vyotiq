/**
 * Phase 0.1 — ModelPickerPanel must not re-render every ModelRow when
 * `lastDiscoveredAt` mutates on an unrelated provider discover pass.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ModelPickerPanel } from '@renderer/components/composer/modelPicker/ModelPickerPanel';
import { useProviderStore } from '@renderer/store/useProviderStore';

const rowRenderCounts = new Map<string, number>();

vi.mock('@renderer/components/composer/modelPicker/ModelRow.js', () => ({
  ModelRow: (props: { provider: { id: string }; model: { id: string } }) => {
    const key = `${props.provider.id}::${props.model.id}`;
    rowRenderCounts.set(key, (rowRenderCounts.get(key) ?? 0) + 1);
    return <div data-testid={`row-${key}`} />;
  }
}));

function makeModels(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-model-${i}`,
    contextWindow: 128_000
  }));
}

beforeEach(() => {
  rowRenderCounts.clear();
  useProviderStore.setState({
    providers: [
      {
        id: 'local',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:11434',
        enabled: true,
        models: makeModels(50, 'local'),
        lastDiscoveredAt: 1
      },
      {
        id: 'remote',
        name: 'Remote',
        baseUrl: 'https://api.example.com',
        enabled: true,
        models: makeModels(3, 'remote'),
        lastDiscoveredAt: 1
      }
    ],
    loading: false,
    error: null
  });
});

describe('ModelPickerPanel render budget', () => {
  it('does not re-render all rows when only lastDiscoveredAt changes', async () => {
    render(
      <ModelPickerPanel
        value={null}
        onChange={() => {}}
        onClose={() => {}}
        onOpenProviders={() => {}}
      />
    );

    const sampleKey = 'local::local-model-0';
    const afterMount = rowRenderCounts.get(sampleKey) ?? 0;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      useProviderStore.setState((s) => ({
        providers: s.providers.map((p) =>
          p.id === 'remote'
            ? { ...p, lastDiscoveredAt: Date.now(), models: [...(p.models ?? [])] }
            : p
        )
      }));
    });

    const afterDiscover = rowRenderCounts.get(sampleKey) ?? 0;
    // Allow at most one extra render from parent list reconciliation — not O(n) per row.
    expect(afterDiscover - afterMount).toBeLessThanOrEqual(2);
    expect(rowRenderCounts.get('local::local-model-49') ?? 0).toBeLessThanOrEqual(afterMount + 2);
  });
});
