/**
 * ComposerCacheStatPill — prompt-cache stats in the metrics row.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerCacheStatPill } from '@renderer/components/composer/ComposerCacheStatPill';
import { useChatStore } from '@renderer/store/useChatStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import type { ModelSelection } from '@shared/types/provider';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const OPENAI_PROVIDER_ID = 'prov-openai';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    isProcessing: false,
    orchestratorUsage: undefined,
    events: []
  });
  useProviderStore.setState({
    providers: [
      {
        id: OPENAI_PROVIDER_ID,
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        dialect: 'openai',
        enabled: true,
        models: []
      },
      {
        id: 'prov-ollama',
        name: 'Ollama Cloud',
        baseUrl: 'https://ollama.com',
        dialect: 'ollama-native',
        enabled: true,
        models: []
      }
    ]
  } as never);
});

const openAiModel: ModelSelection = { providerId: OPENAI_PROVIDER_ID, modelId: 'gpt-4o' };
const ollamaModel: ModelSelection = { providerId: 'prov-ollama', modelId: 'gemma4:31b' };

describe('ComposerCacheStatPill', () => {
  it('shows cache read line when orchestrator usage has cached tokens', () => {
    useChatStore.setState({
      isProcessing: true,
      orchestratorUsage: {
        latest: { promptTokens: 50_000, completionTokens: 200, totalTokens: 50_200, cachedPromptTokens: 34_000 },
        peak: { promptTokens: 50_000, completionTokens: 200, totalTokens: 50_200, cachedPromptTokens: 34_000 },
        cumulative: { promptTokens: 50_000, completionTokens: 200, totalTokens: 50_200, cachedPromptTokens: 34_000 },
        samples: 2
      }
    } as never);

    render(<ComposerCacheStatPill model={openAiModel} />);
    const pill = screen.getByRole('status');
    expect(pill.textContent).toMatch(/34k tok cached/);
    expect(pill.textContent).toMatch(/68% of prompt/);
  });

  it('warns when multi-turn prompt has no cache read', () => {
    useChatStore.setState({
      isProcessing: false,
      orchestratorUsage: {
        latest: { promptTokens: 4_096, completionTokens: 100, totalTokens: 4_196, cachedPromptTokens: 0 },
        peak: { promptTokens: 4_096, completionTokens: 100, totalTokens: 4_196 },
        cumulative: { promptTokens: 8_000, completionTokens: 200, totalTokens: 8_200 },
        samples: 3
      }
    } as never);

    render(<ComposerCacheStatPill model={openAiModel} />);
    const pill = screen.getByRole('status');
    expect(pill.textContent).toMatch(/No cache read/);
    expect(pill.textContent).toMatch(/4\.1k tok prompt/);
  });

  it('does not warn on cache read for ollama-native (no wire cache metrics)', () => {
    useChatStore.setState({
      isProcessing: true,
      orchestratorUsage: {
        latest: { promptTokens: 180_284, completionTokens: 100, totalTokens: 180_384 },
        peak: { promptTokens: 180_284, completionTokens: 100, totalTokens: 180_384 },
        cumulative: { promptTokens: 500_000, completionTokens: 5_000, totalTokens: 505_000 },
        samples: 4
      }
    } as never);

    const { container } = render(<ComposerCacheStatPill model={ollamaModel} />);
    expect(container.querySelector('.vx-composer-cache-stat')).toBeNull();
    expect(screen.queryByText(/No cache read/)).toBeNull();
  });
});
