/**
 * ComposerStatusStrip — ask-user reply hint only.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { useChatStore } from '@renderer/store/useChatStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
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
  useTimelineUiStore.setState({ timelineAtTail: true });
});

const openAiModel: ModelSelection = { providerId: OPENAI_PROVIDER_ID, modelId: 'gpt-4o' };
const ollamaModel: ModelSelection = { providerId: 'prov-ollama', modelId: 'gemma4:31b' };

describe('ComposerStatusStrip', () => {
  it('renders nothing when at tail with no ask-user', () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });
    useTimelineUiStore.setState({ timelineAtTail: false });

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
  });

  it('shows ask-user hint when pending', () => {
    render(
      <ComposerStatusStrip
        pendingAskUser={{
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          payload: { title: 'Choose one', questions: [] }
        }}
      />
    );

    expect(screen.getByText(/Reply needed/i)).toBeInTheDocument();
    expect(screen.getByText(/"Choose one"/i)).toBeInTheDocument();
  });

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

    render(<ComposerStatusStrip model={openAiModel} />);
    const strip = screen.getByRole('status');
    expect(strip.textContent).toMatch(/OpenAI/);
    expect(strip.textContent).toMatch(/34k tok cached/);
    expect(strip.textContent).toMatch(/68% of prompt/);
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

    render(<ComposerStatusStrip model={openAiModel} />);
    const strip = screen.getByRole('status');
    expect(strip.textContent).toMatch(/OpenAI/);
    expect(strip.textContent).toMatch(/No cache read/);
    expect(strip.textContent).toMatch(/4\.1k tok prompt/);
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

    const { container } = render(<ComposerStatusStrip model={ollamaModel} />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/No cache read/)).toBeNull();
  });

  it('does not show run phase labels', () => {
    useChatStore.setState({
      isProcessing: true,
      runStartedAt: Date.now() - 5000,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: Date.now(),
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    } as never);

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/Exploring/i)).toBeNull();
  });
});
