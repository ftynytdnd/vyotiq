/**
 * Pins optional run-budget halts in `runOrchestratorLoop`:
 *   - Per-run token budget: halts after cumulative `usage.totalTokens`
 *     crosses the configured ceiling.
 *   - Per-run wall-clock budget: halts at the top of an iteration once
 *     elapsed time crosses the configured ceiling (before any LLM turn).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings';

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
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
      metaRulesXml: '<meta_rules>stub</meta_rules>'
    }))
  };
});
vi.mock('@main/harness/harnessLoader', () => ({
  buildOrchestratorSystemPrompt: () => '<system_instructions>stub</system_instructions>',
  buildStaticFewShotXml: () => '<static_examples>stub</static_examples>'
}));
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
  getProviderWithKey: vi.fn(async () => ({
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    dialect: 'openai'
  }))
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { runOrchestratorLoop, __test_resetRecentBillingBlock } from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
  __test_resetRecentBillingBlock();
});

const baseInput = {
  runId: 'run-budget',
  prompt: 'hi',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowAuto: false }
} as const;

const okTurn = (totalTokens: number) => ({
  assistantMsgId: 'msg-b',
  assistantText: 'working on it',
  reasoningText: '',
  partialToolCalls: [],
  hadText: true,
  hadReasoning: false,
  reasoningEndEmitted: false,
  usage: { promptTokens: 0, completionTokens: totalTokens, totalTokens }
});

describe('runOrchestratorLoop — run budgets', () => {
  it('halts when the cumulative token budget is exceeded after a turn', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValue(okTurn(60_000) as never);

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-budget' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false,
      agentBehaviorSettings: resolveAgentBehaviorSettings({
        agentBehavior: { runTokenBudget: { enabled: true, maxTotalTokens: 50_000 } }
      })
    } as never);

    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(result.terminalError).toMatch(/token budget/i);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(/60,000 \/ 50,000/);
  });

  it('does not halt when cumulative tokens stay under the budget', async () => {
    // One under-budget turn that fully answers the user (implicit finish),
    // so the run ends cleanly in a single iteration with no budget error.
    vi.mocked(handleAssistantTurn).mockResolvedValue({
      ...okTurn(1_000),
      assistantText: 'All done — the requested change is complete and verified.'
    } as never);

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-budget-2' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false,
      agentBehaviorSettings: resolveAgentBehaviorSettings({
        agentBehavior: { runTokenBudget: { enabled: true, maxTotalTokens: 50_000 } }
      })
    } as never);

    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(result.terminalError).toBeUndefined();
    expect(events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('halts at the top of the iteration when the wall-clock budget is exceeded', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValue(okTurn(10) as never);

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-budget-wc' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false,
      // Anchor the run start far in the past so the very first iteration
      // is already past the 1-minute budget ceiling.
      runStartedAt: Date.now() - 10_000_000,
      agentBehaviorSettings: resolveAgentBehaviorSettings({
        agentBehavior: { runWallClockBudget: { enabled: true, maxDurationMs: 60_000 } }
      })
    } as never);

    expect(handleAssistantTurn).not.toHaveBeenCalled();
    expect(result.terminalError).toMatch(/wall-clock budget/i);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
  });
});
