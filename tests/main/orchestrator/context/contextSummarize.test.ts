import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  resolveSummarizationCandidates,
  summarizeHistory
} from '@main/orchestrator/context/contextSummarize';
import {
  __test_resetRecentBillingBlock,
  setRecentBillingBlock
} from '@main/orchestrator/loop/recentBillingBlock';
import { DEFAULT_CONTEXT_MANAGEMENT_SETTINGS } from '@shared/settings/agentBehaviorSettings';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async (id: string) => {
    if (id === 'ollama') {
      return {
        id: 'ollama',
        enabled: true,
        models: [
          { id: 'deepseek-v3.1:671b', contextWindow: 128_000 },
          { id: 'gemma4:4b', contextWindow: 32_000 }
        ]
      };
    }
    return null;
  })
}));

const streamChatMock = vi.fn();

vi.mock('@main/providers/chatClient', () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args)
}));

async function* okStream() {
  yield { contentDelta: '## Task intent\nDone' };
}

describe('contextSummarize', () => {
  let workspacePath: string;

  beforeEach(async () => {
    __test_resetRecentBillingBlock();
    streamChatMock.mockReset();
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-sum-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('orders candidates as summary model, run model, then siblings', async () => {
    const candidates = await resolveSummarizationCandidates(
      {
        ...DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
        summaryModel: { providerId: 'openai', modelId: 'gpt-4o-mini' }
      },
      { providerId: 'ollama', modelId: 'deepseek-v3.1:671b' }
    );

    expect(candidates.map((c) => `${c.providerId}/${c.modelId}`)).toEqual([
      'openai/gpt-4o-mini',
      'ollama/deepseek-v3.1:671b',
      'ollama/gemma4:4b'
    ]);
  });

  it('skips billing-blocked models and falls back to the next candidate', async () => {
    setRecentBillingBlock(
      { providerId: 'ollama', modelId: 'deepseek-v3.1:671b' },
      'subscription required'
    );

    streamChatMock.mockImplementation(() => okStream());

    const outcome = await summarizeHistory({
      history: [{ role: 'user', content: 'hello from a long session' }],
      candidates: await resolveSummarizationCandidates(DEFAULT_CONTEXT_MANAGEMENT_SETTINGS, {
        providerId: 'ollama',
        modelId: 'deepseek-v3.1:671b'
      }),
      conversationId: 'conv-1',
      runId: 'run-1',
      workspacePath
    });

    expect(outcome.result?.modelId).toBe('gemma4:4b');
    expect(streamChatMock).toHaveBeenCalledTimes(1);
    expect(streamChatMock.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'ollama',
      model: 'gemma4:4b'
    });
  });

  it('returns a failure message when every candidate fails', async () => {
    const { ProviderError } = await import('@main/providers/providerError.js');
    streamChatMock.mockImplementation(() => {
      throw new ProviderError({
        kind: 'billing',
        status: 403,
        providerId: 'ollama',
        providerName: 'Ollama Cloud',
        friendlyMessage: 'Ollama Cloud: subscription required',
        surface: 'chat',
        rawBody: '{"error":"subscription"}'
      });
    });

    const outcome = await summarizeHistory({
      history: [{ role: 'user', content: 'needs summary' }],
      candidates: [{ providerId: 'ollama', modelId: 'deepseek-v3.1:671b' }],
      conversationId: 'conv-2',
      runId: 'run-2',
      workspacePath
    });

    expect(outcome.result).toBeNull();
    expect(outcome.failureMessage).toMatch(/subscription required/i);
  });
});
