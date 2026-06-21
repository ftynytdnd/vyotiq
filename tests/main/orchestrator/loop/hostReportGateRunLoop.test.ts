import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { createRunStateAccumulator } from '@main/orchestrator/loop/buildRunState';
import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature';

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn()
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
      metaRulesXml: '<meta_rules>stub</meta_rules>',
      runProgressXml: ''
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

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { runOrchestratorLoop } from '@main/orchestrator/loop/runLoop';

const baseInput = {
  runId: 'run-gate',
  prompt: 'fix files',
  selection: { providerId: 'p', modelId: 'm' }
} as const;

describe('runOrchestratorLoop — host report gate resume', () => {
  beforeEach(() => {
    vi.mocked(handleAssistantTurn).mockReset();
    vi.mocked(handleToolCalls).mockReset();
  });

  it('continues after report success until finish is called', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-report',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-report', name: 'report', argumentsBuf: '{"severity":"low"}' }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-finish',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          {
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Report posted.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      });

    vi.mocked(handleToolCalls).mockResolvedValue({
      attempted: 1,
      failed: 0
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-gate' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'fix files' }],
      initialQuery: 'fix files',
      resumeCheckpoint: {
        messages: [{ role: 'system', content: '' }, { role: 'user', content: 'fix files' }],
        query: 'fix files',
        nextIteration: 0,
        consecutiveEmptyTurns: 0,
        injectedStubsHighWater: 0,
        consecutiveErrors: 0,
        consecutiveBadToolRounds: 0,
        runStateAcc: createRunStateAccumulator(),
        spin: createSpinSignatureBuffer(),
        askUserToolCallId: 'ask-gate',
        askUserPromptEventId: 'prompt-gate',
        askUserPayload: { title: 'gate', questions: [] },
        hostReportGate: true,
        pendingTerminal: 'implicit-finish',
        reportGateBonusIteration: true,
        runCumulativeTokens: 0
      }
    });

    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    expect(handleToolCalls).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    const finishResult = events.find(
      (e) => e.kind === 'tool-result' && e.result.name === 'finish'
    );
    expect(finishResult?.kind).toBe('tool-result');
  });
});
