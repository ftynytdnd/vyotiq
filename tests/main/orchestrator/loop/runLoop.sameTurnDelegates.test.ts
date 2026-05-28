/**
 * runLoop — same-turn tool calls + delegate directives.
 *
 * Before the plan fix, a turn that emitted orchestrator tool calls AND
 * `<delegate />` tags only ran handleToolCalls and skipped delegates.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleDelegates', () => ({
  handleDelegates: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleNoToolNoDelegate', () => ({
  handleNoToolNoDelegate: vi.fn(() => 'terminate' as const)
}));
vi.mock('@main/orchestrator/contextManager', async () => {
  const real = await vi.importActual<typeof import('@main/orchestrator/contextManager')>(
    '@main/orchestrator/contextManager'
  );
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
  buildOrchestratorSystemPrompt: () => '<system_instructions>stub</system_instructions>'
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

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { handleDelegates } from '@main/orchestrator/loop/handleDelegates';
import { runOrchestratorLoop } from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
  vi.mocked(handleToolCalls).mockReset();
  vi.mocked(handleDelegates).mockReset();
});

describe('runOrchestratorLoop — same-turn delegates', () => {
  it('runs handleDelegates after handleToolCalls when both appear in one turn', async () => {
    const delegateText = '<delegate id="A1" task="Inspect foo" files="src/foo.ts" tools="read" />';

    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-1',
        assistantText: `Survey complete.\n${delegateText}`,
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-1', name: 'ls', argumentsBuf: '{"path":"src"}' }
        ],
        hadText: true,
        hadReasoning: false,
        reasoningEndEmitted: false
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-2',
        assistantText: 'Done.',
        reasoningText: '',
        partialToolCalls: [],
        hadText: true,
        hadReasoning: false,
        reasoningEndEmitted: false
      });

    vi.mocked(handleToolCalls).mockResolvedValueOnce({
      attempted: 1,
      failed: 0,
      childRedelegations: 0
    });
    vi.mocked(handleDelegates).mockResolvedValueOnce('continue');

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: {
        runId: 'run-1',
        prompt: 'analyze',
        conversationId: 'conv-1',
        selection: { providerId: 'p', modelId: 'm' },
        permissions: { allowAuto: false }
      },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'analyze' }],
      initialQuery: 'analyze',
      permissions: { allowAuto: false },
      strictApprovals: false
    });

    expect(handleToolCalls).toHaveBeenCalledTimes(1);
    expect(handleDelegates).toHaveBeenCalledTimes(1);
    const delegateArg = vi.mocked(handleDelegates).mock.calls[0]?.[0];
    expect(delegateArg?.[0]?.id).toBe('A1');
  });
});
