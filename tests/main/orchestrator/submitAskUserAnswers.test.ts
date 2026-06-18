import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';

const { runOrchestratorLoop } = vi.hoisted(() => ({
  runOrchestratorLoop: vi.fn(async () => ({}))
}));

vi.mock('@main/orchestrator/loop/index.js', () => ({
  runOrchestratorLoop
}));
vi.mock('@main/harness/harnessLoader.js', () => ({
  buildOrchestratorSystemPrompt: () => '',
  buildStaticFewShotXml: () => '<static_examples></static_examples>'
}));
vi.mock('@main/orchestrator/replay/index.js', () => ({
  replayTranscript: vi.fn(() => [])
}));
vi.mock('@main/orchestrator/buildUserTurnMessage.js', () => ({
  buildUserTurnMessage: vi.fn(async () => ({
    message: { role: 'user', content: '<turn>test</turn>' },
    turnXml: '<turn>test</turn>',
    visionTokenEstimate: 0,
    usedVisionParts: false
  })),
  enrichReplayedVisionMessages: vi.fn(async (messages: unknown[]) => messages),
  resolveInputModalitiesForSelection: vi.fn(async () => ['text', 'image'])
}));
vi.mock('@main/attachments/preparedMediaCache.js', () => ({
  getPreparedMediaCache: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), clear: vi.fn() })),
  clearPreparedMediaCache: vi.fn()
}));
vi.mock('@main/attachments/resolveAttachmentsForInline.js', () => ({
  resolveAttachmentsForInline: vi.fn(async () => [])
}));
vi.mock('@main/checkpoints/index.js', () => ({
  openCheckpointRun: vi.fn(async () => undefined),
  finalizeCheckpointRun: vi.fn(async () => undefined)
}));
vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(async () => '/tmp/ws'),
  requireWorkspace: vi.fn(async () => '/tmp/ws')
}));
vi.mock('@main/tools/recall.tool.js', () => ({
  setActiveConversationForRun: vi.fn(),
  setActiveWorkspaceForRun: vi.fn()
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { startRun, submitAskUserAnswers } from '@main/orchestrator/AgentV';

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
      workspaceXml: '',
      sessionXml: '',
      priorConversationsXml: '',
      memoryXml: '',
      metaRulesXml: '',
      runProgressXml: ''
    }))
  };
});
vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => undefined)
}));

describe('submitAskUserAnswers', () => {
  beforeEach(() => {
    vi.mocked(handleAssistantTurn).mockReset();
    runOrchestratorLoop.mockReset();
  });

  it('returns false when no paused run exists', async () => {
    const ok = await submitAskUserAnswers({
      runId: 'missing',
      conversationId: 'conv-1',
      promptEventId: 'p1',
      toolCallId: 'tc-1',
      payload: { questions: [{ id: 'q1', prompt: 'Q?', options: [] }] },
      answers: [{ questionId: 'q1', freeText: 'yes' }]
    });
    expect(ok).toBe(false);
  });

  it('emits user/tool events and resumes the loop after ask_user pause', async () => {
    const checkpoint = {
      messages: [{ role: 'system', content: '' }] as ChatMessage[],
      query: 'go',
      nextIteration: 1,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc: {
        iteration: 0,
        toolRoundsTotal: 0,
        lastAction: 'clarify' as const,
        spinSignatureHot: null
      },
      spin: { window: [] as string[] },
      askUserToolCallId: 'tc-ask',
      askUserPromptEventId: 'prompt-1',
      askUserPayload: {
        questions: [{ id: 'legacy', prompt: 'Which branch?', options: [] }]
      }
    };

    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [
        {
          id: 'tc-ask',
          name: 'ask_user',
          argumentsBuf: JSON.stringify({ question: 'Which branch?' })
        }
      ],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false
    });
    runOrchestratorLoop
      .mockResolvedValueOnce({ pausedForAskUser: checkpoint })
      .mockResolvedValueOnce({});

    const events: unknown[] = [];
    const onDone = vi.fn();
    const onAwaitingUser = vi.fn();

    await startRun(
      {
        runId: 'run-ask',
        prompt: 'go',
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
        selection: { providerId: 'p', modelId: 'm' },
      },
      {
        emit: (e) => events.push(e),
        onDone,
        onError: vi.fn(),
        onAwaitingUser
      }
    );

    expect(onAwaitingUser).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();

    const ok = await submitAskUserAnswers({
      runId: 'run-ask',
      conversationId: 'conv-1',
      promptEventId: 'prompt-1',
      toolCallId: 'tc-ask',
      payload: checkpoint.askUserPayload,
      answers: [{ questionId: 'legacy', freeText: 'main' }]
    });

    expect(ok).toBe(true);
    expect(events.some((e) => (e as { kind?: string }).kind === 'ask-user-submitted')).toBe(true);
    expect(events.some((e) => (e as { kind?: string }).kind === 'tool-result')).toBe(true);
    expect(runOrchestratorLoop).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
