/**
 * ModelPickerPanel interaction: nav dedup, duplicate-row focus, stay-open on effort change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelPickerPanel } from '@renderer/components/composer/modelPicker/ModelPickerPanel';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

vi.mock('@renderer/components/composer/modelPicker/ModelPickerSidePanel.js', () => ({
  ModelPickerSidePanel: ({
    onChange
  }: {
    onChange: (sel: { providerId: string; modelId: string; thinkingEffort?: string }) => void;
  }) => (
    <div data-testid="side-panel">
      <button
        type="button"
        data-testid="effort-high"
        onClick={() =>
          onChange({ providerId: 'remote', modelId: 'remote-model-0', thinkingEffort: 'high' })
        }
      >
        Set high effort
      </button>
    </div>
  )
}));

beforeEach(() => {
  useProviderStore.setState({
    providers: [
      {
        id: 'remote',
        name: 'Remote',
        baseUrl: 'https://api.example.com',
        dialect: 'openai',
        enabled: true,
        models: [
          { id: 'remote-model-0', contextWindow: 128_000 },
          { id: 'remote-model-1', contextWindow: 128_000 }
        ]
      }
    ],
    loading: false,
    error: null
  });
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      ui: {
        ...s.settings.ui,
        favoriteModels: ['remote::remote-model-0']
      }
    }
  }));
});

describe('ModelPickerPanel behavior', () => {
  it('shows favorited model in both Favorites and provider group', () => {
    render(
      <ModelPickerPanel
        value={null}
        onChange={() => {}}
        onClose={() => {}}
        onOpenProviders={() => {}}
      />
    );

    const duplicates = document.querySelectorAll('[data-model-key="remote::remote-model-0"]');
    expect(duplicates.length).toBe(2);
  });

  it('does not close when effort changes via side panel', () => {
    const onClose = vi.fn();
    const onChange = vi.fn();

    render(
      <ModelPickerPanel
        value={{ providerId: 'remote', modelId: 'remote-model-0' }}
        onChange={onChange}
        onClose={onClose}
        onOpenProviders={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId('effort-high'));
    expect(onChange).toHaveBeenCalledWith({
      providerId: 'remote',
      modelId: 'remote-model-0',
      thinkingEffort: 'high'
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows keyboard hint line', () => {
    render(
      <ModelPickerPanel
        value={null}
        onChange={() => {}}
        onClose={() => {}}
        onOpenProviders={() => {}}
      />
    );

    expect(screen.getByText('search', { exact: false })).toBeInTheDocument();
    expect(document.querySelector('.vx-model-picker-hints')).not.toBeNull();
  });
});
