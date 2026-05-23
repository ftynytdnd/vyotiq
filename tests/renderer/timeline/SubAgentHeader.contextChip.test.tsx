/**
 * Phase 6 (2026) — `SubAgentHeader` ceiling-aware ctx chip.
 *
 * Pins:
 *   - The chip is hidden when the run has no model resolution OR
 *     the provider has no ceiling stamped for the model.
 *   - When a ceiling resolves, the chip shows `<pct>% ctx` rendered
 *     from `usage.latest.promptTokens / ceiling`.
 *   - Tone shifts at 70% (amber) and 90% (red) — same thresholds
 *     as the composer pill, so the surfaces feel symmetric.
 *   - A worker without observed prompt tokens (just spawned) renders
 *     no chip to avoid a misleading `0% ctx`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, act } from '@testing-library/react';
import { SubAgentHeader } from '@renderer/components/timeline/subagent/SubAgentHeader';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';
import { useChatStore } from '@renderer/store/useChatStore';
import { useProviderStore } from '@renderer/store/useProviderStore';

function snap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'sa-1',
    task: 'look at things',
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: 0,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

function setRunModel(runId: string, modelId: string) {
  act(() => {
    useChatStore.setState((s) => ({
      ...s,
      runId,
      runIdToModel: { ...s.runIdToModel, [runId]: modelId }
    }));
  });
}

function setProviderWithModel(providerId: string, modelId: string, ceiling: number) {
  act(() => {
    useProviderStore.setState((s) => ({
      ...s,
      providers: [
        {
          id: providerId,
          name: 'Test Provider',
          baseUrl: 'https://example.test',
          kind: 'openai-compat',
          dialect: 'openai',
          models: [{ id: modelId, contextWindow: ceiling }]
        } as never
      ]
    }));
  });
}

beforeEach(() => {
  act(() => {
    useChatStore.setState((s) => ({
      ...s,
      runId: null,
      runIdToConv: {},
      runIdToModel: {}
    }));
    useProviderStore.setState((s) => ({ ...s, providers: [] }));
  });
});

afterEach(() => {
  act(() => {
    useChatStore.setState((s) => ({
      ...s,
      runId: null,
      runIdToConv: {},
      runIdToModel: {}
    }));
    useProviderStore.setState((s) => ({ ...s, providers: [] }));
  });
});

describe('SubAgentHeader — SubAgentContextChip (Phase 6)', () => {
  it('is hidden when no model is resolved for the run', () => {
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            peak: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            cumulative: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            samples: 1
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toMatch(/% ctx/);
  });

  it('is hidden when no ceiling resolves for the run model', () => {
    setRunModel('run-1', 'unknown-model');
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            peak: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            cumulative: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            samples: 1
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toMatch(/% ctx/);
  });

  it('renders <pct>% ctx when ceiling resolves', () => {
    setRunModel('run-1', 'gpt-5');
    setProviderWithModel('p-1', 'gpt-5', 128_000);
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            peak: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            cumulative: { promptTokens: 64_000, completionTokens: 100, totalTokens: 64_100 },
            samples: 1
          }
        })}
      />
    );
    expect(container.textContent ?? '').toContain('50% ctx');
  });

  it('uses the warning tone above 70%', () => {
    setRunModel('run-1', 'gpt-5');
    setProviderWithModel('p-1', 'gpt-5', 128_000);
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 100_000, completionTokens: 100, totalTokens: 100_100 },
            peak: { promptTokens: 100_000, completionTokens: 100, totalTokens: 100_100 },
            cumulative: { promptTokens: 100_000, completionTokens: 100, totalTokens: 100_100 },
            samples: 1
          }
        })}
      />
    );
    const chip = Array.from(container.querySelectorAll('span')).find((el) =>
      (el.textContent ?? '').includes('% ctx')
    );
    expect(chip?.className).toContain('text-warning');
  });

  it('uses the danger tone above 90%', () => {
    setRunModel('run-1', 'gpt-5');
    setProviderWithModel('p-1', 'gpt-5', 128_000);
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 125_000, completionTokens: 100, totalTokens: 125_100 },
            peak: { promptTokens: 125_000, completionTokens: 100, totalTokens: 125_100 },
            cumulative: { promptTokens: 125_000, completionTokens: 100, totalTokens: 125_100 },
            samples: 1
          }
        })}
      />
    );
    const chip = Array.from(container.querySelectorAll('span')).find((el) =>
      (el.textContent ?? '').includes('% ctx')
    );
    expect(chip?.className).toContain('text-danger');
  });

  it('is hidden for a worker that has not reported prompt tokens yet', () => {
    setRunModel('run-1', 'gpt-5');
    setProviderWithModel('p-1', 'gpt-5', 128_000);
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          usage: {
            latest: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            peak: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            samples: 1
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toMatch(/% ctx/);
  });
});
