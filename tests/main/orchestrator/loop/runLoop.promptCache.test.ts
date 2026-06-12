/**
 * Pins prompt-cache miss logging in `runOrchestratorLoop`:
 * dialects without wire cache metrics (e.g. Ollama native) must not warn.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import type { ProviderDialect } from '@shared/types/provider';

const { logWarn, getProviderWithKey } = vi.hoisted(() => ({
  logWarn: vi.fn(),
  getProviderWithKey: vi.fn<
    () => Promise<{ dialect: ProviderDialect } | undefined>
  >()
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: {
    child: () => ({
      warn: logWarn,
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}));

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn(async () => ({ attempted: 1, failed: 0 }))
}));
vi.mock('@main/orchestrator/contextManager', async () => {
  const real = await vi.importActual<
    typeof import('@main/orchestrator/contextManager')
  >('@main/orchestrator/contextManager');
  return {
    ...real,
    refreshEnvelopes: vi.fn(async () => ({
      workspaceXml: '<workspace_context>stub</workspace_context>',
      sessionXml: '<session_context>stub</session_context>',
      priorConversationsXml: '<prior_conversations>stub</prior_conversations>',
      memoryXml: '<recent_memory>stub</recent_memory>',
      metaRulesXml: '<meta_rules>stub</meta_rules>',
      runProgressXml: ''
    }))
  };
});
vi.mock('@main/harness/harnessLoader', () => ({
  buildOrchestratorSystemPrompt: () => '<system_instructions>stub</system_instructions>',
  buildStaticFewShotXml: () => '<static_examples>stub</static_examples>'
}));
vi.mock('@main/orchestrator/retry', async () => {
  const real = await vi.importActual<typeof import('@main/orchestrator/retry')>(
    '@main/orchestrator/retry'
  );
  return { ...real, backoff: vi.fn(async () => undefined) };
});
vi.mock('@main/orchestrator/loop/buildOrchestratorRequest', () => ({
  buildOrchestratorRequest: vi.fn((opts: {
    selection: { providerId: string; modelId: string };
    messages: unknown;
    signal: AbortSignal;
  }) => ({
    providerId: opts.selection.providerId,
    model: opts.selection.modelId,
    messages: opts.messages,
    signal: opts.signal
  }))
}));

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: (...args: unknown[]) => getProviderWithKey(...args)
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { runOrchestratorLoop, __test_resetRecentBillingBlock } from '@main/orchestrator/loop/runLoop';

const baseInput = {
  runId: 'run-pc',
  prompt: 'list files',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowAuto: true }
} as const;

const listDirTurn = {
  assistantMsgId: 'msg-tool',
  assistantText: '',
  reasoningText: '',
  partialToolCalls: [
    { id: 'tc-1', name: 'list_dir', argumentsBuf: '{"path":"."}' }
  ],
  hadText: false,
  hadReasoning: false,
  reasoningEndEmitted: false,
  finishReason: 'tool_calls' as const
};

const finishTurn = (usage: { promptTokens: number; cachedPromptTokens?: number }) => ({
  assistantMsgId: 'msg-done',
  assistantText: 'Here are the files in the workspace root directory.',
  reasoningText: '',
  partialToolCalls: [],
  hadText: true,
  hadReasoning: false,
  reasoningEndEmitted: false,
  finishReason: 'stop' as const,
  usage: {
    promptTokens: usage.promptTokens,
    completionTokens: 12,
    totalTokens: usage.promptTokens + 12,
  ...(usage.cachedPromptTokens !== undefined
    ? { cachedPromptTokens: usage.cachedPromptTokens }
    : {})
  }
});

async function runTwoTurnLoop(dialect: ProviderDialect): Promise<void> {
  getProviderWithKey.mockResolvedValue({ dialect });
  vi.mocked(handleAssistantTurn)
    .mockResolvedValueOnce(listDirTurn)
    .mockResolvedValueOnce(
      finishTurn({ promptTokens: 4096, cachedPromptTokens: 0 })
    );

  const events: TimelineEvent[] = [];
  await runOrchestratorLoop({
    input: { ...baseInput, conversationId: 'c-pc' },
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-test',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'list files' }],
    initialQuery: 'list files',
    permissions: baseInput.permissions,
    strictApprovals: false
  });

  expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
  expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
}

function cacheMissWarnings(): unknown[] {
  return logWarn.mock.calls.filter(
    (call) => call[0] === 'prompt cache read near zero on multi-turn iteration'
  );
}

beforeEach(() => {
  logWarn.mockClear();
  vi.mocked(handleAssistantTurn).mockReset();
  getProviderWithKey.mockReset();
  __test_resetRecentBillingBlock();
});

describe('runOrchestratorLoop — prompt cache miss logging', () => {
  it('warns on multi-turn zero cache read for dialects that report cache metrics', async () => {
    await runTwoTurnLoop('openai');
    expect(cacheMissWarnings()).toHaveLength(1);
  });

  it('does not warn for ollama-native (no wire cache metrics)', async () => {
    await runTwoTurnLoop('ollama-native');
    expect(cacheMissWarnings()).toHaveLength(0);
  });
});
