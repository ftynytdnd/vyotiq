import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  __test_resetRecordedPromptSpend,
  recordWorkspaceSpendForPrompt
} from '@renderer/lib/workspaceSpend';

const addWorkspaceSpend = vi.fn(async () => {});

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: {
    getState: () => ({ addWorkspaceSpend })
  }
}));

describe('recordWorkspaceSpendForPrompt', () => {
  beforeEach(() => {
    __test_resetRecordedPromptSpend();
    addWorkspaceSpend.mockClear();
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
