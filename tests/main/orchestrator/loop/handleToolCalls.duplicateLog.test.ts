import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';

const { runToolByName, logWarn, logDebug } = vi.hoisted(() => ({
  runToolByName: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn()
}));

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (...args: unknown[]) => runToolByName(...args)
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: {
    child: () => ({
      warn: logWarn,
      debug: logDebug,
      info: vi.fn(),
      error: vi.fn()
    })
  }
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';

describe('handleToolCalls duplicate-only logging', () => {
  const emit = vi.fn<(e: TimelineEvent) => void>();
  const messages: ChatMessage[] = [];
  const baseOpts = {
    workspacePath: '/ws',
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    signal: new AbortController().signal
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messages.length = 0;
  });

  it('logs debug (not warn) when all failures are duplicate_tool_call', async () => {
    runToolByName.mockResolvedValueOnce({
      id: 'c1',
      name: 'read',
      ok: false,
      output: 'BLOCKED: Tool "read" was called with identical arguments 2 times in this run.',
      error: 'duplicate_tool_call',
      durationMs: 0
    });
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'read', argumentsBuf: '{"path":"a.ts"}' }
    ];
    const summary = await handleToolCalls(calls, messages, emit, baseOpts);
    expect(summary.failed).toBe(1);
    expect(summary.duplicateFailures).toBe(1);
    expect(logDebug).toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('logs warn when a real tool failure occurs', async () => {
    runToolByName.mockResolvedValueOnce({
      id: 'c1',
      name: 'bash',
      ok: false,
      output: '--- exit: 1 ---',
      error: 'exited with code 1',
      durationMs: 1
    });
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'bash', argumentsBuf: '{"command":"git init"}' }
    ];
    await handleToolCalls(calls, messages, emit, baseOpts);
    expect(logWarn).toHaveBeenCalled();
  });
});
