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
  recordWorkspaceSpendForPrompt,
  resolveLiveTurnCost
} from '@renderer/lib/workspaceSpend';

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: {
    getState: () => ({ addWorkspaceSpend: addWorkspaceUsage, addWorkspaceUsage })
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

describe('recordWorkspaceSpendForPrompt', () => {
  beforeEach(() => {
    __test_resetRecordedPromptSpend();
    addWorkspaceUsage.mockClear();
    incrementSpend.mockClear();
    patchMeta.mockClear();
    recordTurn.mockClear();
  });

  it('records once per workspace and prompt', async () => {
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    expect(addWorkspaceUsage).toHaveBeenCalledTimes(1);
    expect(addWorkspaceUsage).toHaveBeenCalledWith('ws-1', 0.05, {});
  });

  it('records again for a different prompt', async () => {
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-b', 0.02);
    expect(addWorkspaceUsage).toHaveBeenCalledTimes(2);
  });
});

describe('recordRunSpendForPrompt', () => {
  beforeEach(() => {
    __test_resetRecordedPromptSpend();
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
