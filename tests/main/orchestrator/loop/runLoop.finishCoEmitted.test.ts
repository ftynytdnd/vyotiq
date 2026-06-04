/**
 * runLoop — co-emitted `finish` + actionable tools in one turn.
 *
 * When the model emits `finish` alongside continue-tools or `delegate`
 * calls, actionable work must run first; `finish` is deferred, not dropped.
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

describe('runOrchestratorLoop — co-emitted finish', () => {
  it('runs handleToolCalls when finish and ls appear in one turn', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-1',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-ls', name: 'ls', argumentsBuf: '{"path":"src"}' },
          {
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Done early.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-2',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          {
            id: 'tc-finish-2',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false
      });

    vi.mocked(handleToolCalls).mockResolvedValueOnce({
      attempted: 1,
      failed: 0,
      childRedelegations: 0
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: {
        runId: 'run-finish-co',
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
    expect(handleToolCalls.mock.calls[0]?.[0]?.[0]?.name).toBe('ls');
    expect(handleDelegates).not.toHaveBeenCalled();
    const answerDeltas = events.filter((e) => e.kind === 'agent-text-delta');
    expect(answerDeltas.length).toBe(1);
    expect(answerDeltas[0]?.kind === 'agent-text-delta' && answerDeltas[0].delta).toBe('Done.');
  });
});
