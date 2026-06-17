import { describe, expect, it, vi, beforeEach } from 'vitest';

const { addWorkspaceUsage, incrementSpend, patchMeta, recordTurn } = vi.hoisted(() => ({
  addWorkspaceUsage: vi.fn(async () => {}),
  incrementSpend: vi.fn(async () => ({
    id: 'conv-1',
    title: 'Chat',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    estimatedSpendUsd: 0.05
  })),
  patchMeta: vi.fn(),
  recordTurn: vi.fn()
}));

import {
  __test_resetRecordedPromptSpend,
  recordRunSpendForPrompt,
  resolveLiveTurnCost
} from '@renderer/lib/workspaceSpend';
import {
  __test_resetSpendPromptBaseline,
  syncSpendPromptBaseline
} from '@renderer/lib/spendPromptBaseline';

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: {
    getState: () => ({ addWorkspaceUsage })
  }
}));

vi.mock('@renderer/store/useSessionStatsStore.js', () => ({
  useSessionStatsStore: {
    getState: () => ({ recordTurn })
  }
}));

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    conversations: {
      incrementSpend
    }
  }
}));

vi.mock('@renderer/store/useConversationsStore.js', () => ({
  useConversationsStore: {
    getState: () => ({ patchMeta })
  }
}));

describe('recordRunSpendForPrompt', () => {
  beforeEach(() => {
    __test_resetRecordedPromptSpend();
    __test_resetSpendPromptBaseline();
    addWorkspaceUsage.mockClear();
    incrementSpend.mockClear();
    patchMeta.mockClear();
  });

  it('records workspace and conversation spend once per prompt', async () => {
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-a', 0.05);
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-a', 0.05);
    expect(addWorkspaceUsage).toHaveBeenCalledTimes(1);
    expect(incrementSpend).toHaveBeenCalledTimes(1);
    expect(incrementSpend).toHaveBeenCalledWith('conv-1', 'prompt-a', 0.05, {});
    expect(patchMeta).toHaveBeenCalledTimes(1);
    expect(recordTurn).toHaveBeenCalledTimes(1);
  });

  it('skips spend for prompt ids already present in the hydrated transcript baseline', async () => {
    syncSpendPromptBaseline('conv-1', [
      {
        kind: 'user-prompt',
        id: 'prompt-a',
        ts: 1,
        content: 'hello'
      }
    ]);
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-a', 0.05);
    expect(addWorkspaceUsage).not.toHaveBeenCalled();
    expect(incrementSpend).not.toHaveBeenCalled();
    expect(recordTurn).not.toHaveBeenCalled();
  });

  it('still records spend for a new live prompt not in the baseline', async () => {
    syncSpendPromptBaseline('conv-1', [
      {
        kind: 'user-prompt',
        id: 'prompt-old',
        ts: 1,
        content: 'hello'
      }
    ]);
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-new', 0.05);
    expect(addWorkspaceUsage).toHaveBeenCalledTimes(1);
    expect(incrementSpend).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLiveTurnCost', () => {
  it('marks in-flight usage as partial', () => {
    const providers = [
      {
        id: 'p1',
        name: 'P',
        baseUrl: 'https://api.openai.com/v1',
        dialect: 'openai' as const,
        enabled: true,
        models: [
          {
            id: 'gpt-4o',
            pricing: { inputPerMillion: 2.5, outputPerMillion: 10 }
          }
        ]
      }
    ];
    const live = resolveLiveTurnCost(
      { providerId: 'p1', modelId: 'gpt-4o' },
      providers,
      {
        latest: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        peak: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        samples: 1,
        inFlight: { promptTokens: 0, completionTokens: 100, totalTokens: 100 }
      }
    );
    expect(live?.partial).toBe(true);
    expect(live?.label).toContain('(partial)');
  });
});
