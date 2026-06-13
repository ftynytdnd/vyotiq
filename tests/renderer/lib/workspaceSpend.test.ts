import { describe, expect, it, vi, beforeEach } from 'vitest';

const { addWorkspaceSpend, incrementSpend, patchMeta } = vi.hoisted(() => ({
  addWorkspaceSpend: vi.fn(async () => {}),
  incrementSpend: vi.fn(async () => ({
    id: 'conv-1',
    title: 'Chat',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    estimatedSpendUsd: 0.05
  })),
  patchMeta: vi.fn()
}));

import {
  __test_resetRecordedPromptSpend,
  recordRunSpendForPrompt,
  recordWorkspaceSpendForPrompt
} from '@renderer/lib/workspaceSpend';

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: {
    getState: () => ({ addWorkspaceSpend })
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
    addWorkspaceSpend.mockClear();
    incrementSpend.mockClear();
    patchMeta.mockClear();
  });

  it('records once per workspace and prompt', async () => {
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    expect(addWorkspaceSpend).toHaveBeenCalledTimes(1);
    expect(addWorkspaceSpend).toHaveBeenCalledWith('ws-1', 0.05);
  });

  it('records again for a different prompt', async () => {
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-a', 0.05);
    await recordWorkspaceSpendForPrompt('ws-1', 'prompt-b', 0.02);
    expect(addWorkspaceSpend).toHaveBeenCalledTimes(2);
  });
});

describe('recordRunSpendForPrompt', () => {
  beforeEach(() => {
    __test_resetRecordedPromptSpend();
    addWorkspaceSpend.mockClear();
    incrementSpend.mockClear();
    patchMeta.mockClear();
  });

  it('records workspace and conversation spend once per prompt', async () => {
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-a', 0.05);
    await recordRunSpendForPrompt('ws-1', 'conv-1', 'prompt-a', 0.05);
    expect(addWorkspaceSpend).toHaveBeenCalledTimes(1);
    expect(incrementSpend).toHaveBeenCalledTimes(1);
    expect(incrementSpend).toHaveBeenCalledWith('conv-1', 'prompt-a', 0.05);
    expect(patchMeta).toHaveBeenCalledTimes(1);
  });
});
