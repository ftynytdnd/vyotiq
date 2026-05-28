import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelPickerTrigger } from '@renderer/components/composer/modelPicker/ModelPickerTrigger';
import { useProviderStore } from '@renderer/store/useProviderStore';
import type { ProviderConfig } from '@shared/types/provider.js';

const ollamaProvider: ProviderConfig = {
  id: 'ollama-cloud',
  name: 'Ollama Cloud',
  baseUrl: 'https://ollama.com',
  dialect: 'ollama-native',
  enabled: true,
  models: [{ id: 'gemma4:31b', contextWindow: 128_000 }]
};

beforeEach(() => {
  useProviderStore.setState({
    providers: [ollamaProvider],
    loading: false,
    error: null
  });
});

describe('ModelPickerTrigger', () => {
  it('renders compact model id only without provider logo', () => {
    render(
      <ModelPickerTrigger
        value={{ providerId: 'ollama-cloud', modelId: 'gemma4:31b' }}
        open={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByText('gemma4:31b')).toBeInTheDocument();
    expect(document.querySelector('.vx-provider-logo')).toBeNull();
    expect(document.querySelector('.vx-composer-model-trigger')).not.toBeNull();
    expect(screen.queryByText('Ollama Cloud')).toBeNull();
  });
});
