/**
 * `runOrchestratorLoop` — dynamic agent loop (auto-audit, continue, deferred finish).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat.js';
import { DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT } from '@main/orchestrator/loop/dynamicLoopAudit.js';

const injectFollowUpMock = vi.hoisted(() =>
  vi.fn(async () => ({
    userEnvelope: '<user_turn/>',
    promptEventId: 'evt-audit',
    query: DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT
  }))
);

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn()
}));
vi.mock('@main/orchestrator/followUps/injectFollowUp.js', () => ({
  injectFollowUp: (...args: unknown[]) => injectFollowUpMock(...args)
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
  buildOrchestratorRequest: vi.fn(
    (opts: {
      selection: { providerId: string; modelId: string };
      messages: unknown;
      signal: AbortSignal;
    }) => ({
      providerId: opts.selection.providerId,
      model: opts.selection.modelId,
      messages: opts.messages,
      signal: opts.signal
    })
  )
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn.js';
import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls.js';
import { runOrchestratorLoop } from '@main/orchestrator/loop/runLoop.js';

const baseInput = {
  runId: 'run-dl',
  prompt: 'implement feature',
  selection: { providerId: 'p', modelId: 'm' }
} as const;

function loopOpts(events: TimelineEvent[]) {
  return {
    input: { ...baseInput, conversationId: 'conv-dl' },
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-test',
    signal: new AbortController().signal,
    emit: (e: TimelineEvent) => events.push(e),
    initialMessages: [{ role: 'system' as const, content: '' }, { role: 'user' as const, content: 'go' }],
    initialQuery: 'go'
  };
}

describe('runOrchestratorLoop — dynamic agent loop', () => {
  beforeEach(() => {
    vi.mocked(handleAssistantTurn).mockReset();
    vi.mocked(handleToolCalls).mockReset();
    injectFollowUpMock.mockClear();
    vi.mocked(handleToolCalls).mockResolvedValue({ attempted: 1, failed: 0 });
  });

  it('injects auto-audit after edit and continues the loop', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-edit',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-edit', name: 'edit', argumentsBuf: '{"path":"a.ts","content":"x"}' }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-done',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          {
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Verified and done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop(loopOpts(events));

    expect(injectFollowUpMock).toHaveBeenCalledTimes(1);
    expect(injectFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        followUp: expect.objectContaining({ source: 'dynamic-loop' })
      })
    );
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    expect(events.some((e) => e.kind === 'tool-result' && e.result.name === 'finish')).toBe(true);
  });

  it('does not inject auto-audit after read-only tool rounds', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-read',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-read', name: 'read', argumentsBuf: '{"path":"a.ts"}' }
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
            argumentsBuf: JSON.stringify({ summary: 'Done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop(loopOpts(events));

    expect(injectFollowUpMock).not.toHaveBeenCalled();
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
  });

  it('defers co-emitted finish until after auto-audit on edit', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-edit-finish',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-edit', name: 'edit', argumentsBuf: '{"path":"b.ts","content":"y"}' },
          {
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Too early.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-real-finish',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          {
            id: 'tc-finish-2',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'After audit.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop(loopOpts(events));

    expect(injectFollowUpMock).toHaveBeenCalledTimes(1);
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    const finishResults = events.filter(
      (e) => e.kind === 'tool-result' && e.result.name === 'finish'
    );
    expect(finishResults).toHaveLength(1);
    expect(finishResults[0]!.result.output).toBe('After audit.');
  });

  it('skips back-to-back auto-audit until agent edits again', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-edit-1',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-edit-1', name: 'edit', argumentsBuf: '{"path":"c.ts","content":"z"}' }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce({
        assistantMsgId: 'msg-read',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [
          { id: 'tc-read', name: 'read', argumentsBuf: '{"path":"c.ts"}' }
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
            argumentsBuf: JSON.stringify({ summary: 'Done.' })
          }
        ],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        finishReason: 'tool_calls'
      });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop(loopOpts(events));

    expect(injectFollowUpMock).toHaveBeenCalledTimes(1);
    expect(handleAssistantTurn).toHaveBeenCalledTimes(3);
    expect(events.some((e) => e.kind === 'tool-result' && e.result.name === 'finish')).toBe(true);
  });
});
