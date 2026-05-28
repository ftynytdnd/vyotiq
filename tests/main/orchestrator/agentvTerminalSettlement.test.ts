/**
 * P2a — `startRun` must not call both `onError` and `onDone` on terminal
 * halt paths. `chat.ipc` maps those to `CHAT_ERROR` vs `CHAT_DONE`; a
 * duplicate termination signal confuses the renderer even when
 * `errorRun`/`finishRun` are partially idempotent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSendInput } from '@shared/types/chat';

const runOrchestratorLoop = vi.fn();

vi.mock('@main/orchestrator/loop/index.js', () => ({
  runOrchestratorLoop: (...args: unknown[]) => runOrchestratorLoop(...args)
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspace: vi.fn(async () => '/tmp/ws'),
  requireWorkspaceById: vi.fn(async () => '/tmp/ws')
}));

vi.mock('@main/tools/recall.tool.js', () => ({
  setActiveConversationForRun: vi.fn(),
  setActiveWorkspaceForRun: vi.fn(),
  recallTool: {
    name: 'recall',
    description: '',
    briefMarkdown: '',
    parameters: { type: 'object', properties: {} },
    execute: vi.fn()
  }
}));

vi.mock('@main/orchestrator/contextManager.js', () => ({
  inlineFiles: vi.fn(async () => '')
}));
vi.mock('@main/attachments/resolveAttachmentsForInline.js', () => ({
  resolveAttachmentsForInline: vi.fn(async () => '')
}));
vi.mock('@main/orchestrator/replay/index.js', () => ({
  replayTranscript: vi.fn(() => [])
}));
vi.mock('@main/checkpoints/index.js', () => ({
  openRun: vi.fn(async () => undefined),
  finalizeRun: vi.fn(async () => undefined)
}));
vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({ ui: {} }))
}));

const { startRun } = await import('@main/orchestrator/AgentV');

function makeInput(over: Partial<ChatSendInput> = {}): ChatSendInput {
  return {
    runId: 'run-1',
    prompt: 'hi',
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    selection: { providerId: 'p1', modelId: 'm1' },
    permissions: { allowAuto: false },
    ...over
  };
}

describe('AgentV.startRun — terminal settlement callbacks', () => {
  beforeEach(() => {
    runOrchestratorLoop.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls onError only when the loop returns terminalError', async () => {
    runOrchestratorLoop.mockResolvedValue({
      terminalError: 'Iteration cap (50) reached.'
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    await startRun(makeInput(), { emit: vi.fn(), onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('Iteration cap (50) reached.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls onDone only when the loop completes without terminalError', async () => {
    runOrchestratorLoop.mockResolvedValue({});
    const onDone = vi.fn();
    const onError = vi.fn();

    await startRun(makeInput(), { emit: vi.fn(), onDone, onError });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError only when the loop throws', async () => {
    runOrchestratorLoop.mockRejectedValue(new Error('unexpected'));
    const onDone = vi.fn();
    const onError = vi.fn();

    await startRun(makeInput(), { emit: vi.fn(), onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('unexpected');
    expect(onDone).not.toHaveBeenCalled();
  });
});
