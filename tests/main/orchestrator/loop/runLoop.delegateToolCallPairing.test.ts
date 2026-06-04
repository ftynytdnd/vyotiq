/**
 * Delegate-as-tool-call intercept must not leave orphan `tool_calls` in
 * orchestrator history. Pre-fix, synthetic `role:'tool'` rows were pushed
 * BEFORE the assistant turn while delegate ids still lived in
 * `assistant.tool_calls`, so the next iteration's sanitizer injected
 * stubs and surfaced "Recovered N orphan tool_call(s)".
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { sanitizeToolCallPairingWithStats } from '@main/orchestrator/loop/sanitizeToolPairing';

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

describe('runOrchestratorLoop — delegate tool-call pairing', () => {
  it('does not emit orphan-recovery phase events after parallel delegate tool calls', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-1',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          {
            id: 'tc-a1',
            name: 'delegate',
            argumentsBuf: JSON.stringify({
              id: 'A1',
              task: 'Read core/agent_loop.py',
              files: 'core/agent_loop.py',
              tools: 'read'
            })
          },
          {
            id: 'tc-a2',
            name: 'delegate',
            argumentsBuf: JSON.stringify({
              id: 'A2',
              task: 'Create tests/test_agent_loop.py',
              files: 'tests/test_agent_loop.py',
              tools: 'read,edit'
            })
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
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'All done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false
      });

    vi.mocked(handleDelegates).mockImplementation(async (_delegates, messages) => {
      messages.push({
        role: 'user',
        content: '<subagent_results><result id="A1" status="done">ok</result></subagent_results>'
      });
      return 'continue';
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: {
        runId: 'run-1',
        prompt: 'add tests',
        conversationId: 'conv-1',
        selection: { providerId: 'p', modelId: 'm' },
        permissions: { allowAuto: false }
      },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'add tests' }],
      initialQuery: 'add tests',
      permissions: { allowAuto: false },
      strictApprovals: false
    });

    const orphanPhases = events.filter(
      (e) =>
        e.kind === 'phase' &&
        typeof e.label === 'string' &&
        e.label.includes('Recovered') &&
        e.label.includes('orphan tool_call')
    );
    expect(orphanPhases).toHaveLength(0);
    expect(handleDelegates).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleDelegates).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('leaves delegate ids out of assistant.tool_calls while keeping real tool calls', async () => {
    let history: ChatMessage[] = [];

    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-1',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-ls', name: 'ls', argumentsBuf: '{"path":"src"}' },
          {
            id: 'tc-delegate',
            name: 'delegate',
            argumentsBuf: JSON.stringify({ id: 'A1', task: 'Inspect src', files: 'src', tools: 'read' })
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
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false
      });

    vi.mocked(handleToolCalls).mockImplementation(async (_calls, messages) => {
      messages.push({
        role: 'tool',
        tool_call_id: 'tc-ls',
        name: 'ls',
        content: 'listing'
      });
      return { attempted: 1, failed: 0, childRedelegations: 0 };
    });

    vi.mocked(handleDelegates).mockImplementation(async (_delegates, messages) => {
      history = messages;
      messages.push({ role: 'user', content: '<subagent_results></subagent_results>' });
      return 'continue';
    });

    await runOrchestratorLoop({
      input: {
        runId: 'run-1',
        prompt: 'go',
        conversationId: 'conv-1',
        selection: { providerId: 'p', modelId: 'm' },
        permissions: { allowAuto: false }
      },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: () => undefined,
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'go' }],
      initialQuery: 'go',
      permissions: { allowAuto: false },
      strictApprovals: false
    });

    const assistant = history.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    expect(assistant?.tool_calls?.map((tc) => tc.function.name)).toEqual(['ls']);
    const sanitized = sanitizeToolCallPairingWithStats(history);
    expect(sanitized.stats.injectedStubs).toBe(0);
    expect(sanitized.stats.droppedOrphans).toBe(0);
  });
});
