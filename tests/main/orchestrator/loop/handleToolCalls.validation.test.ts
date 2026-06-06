import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';

const runToolByName = vi.fn();

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (...args: unknown[]) => runToolByName(...args)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';

describe('handleToolCalls pre-dispatch validation', () => {
  const emit = vi.fn<(e: TimelineEvent) => void>();
  const messages: ChatMessage[] = [];
  const baseOpts = {
    workspacePath: '/ws',
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    permissions: {},
    signal: new AbortController().signal
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messages.length = 0;
  });

  it('rejects read without path before toolRunner', async () => {
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'read', argumentsBuf: '' }
    ];
    const summary = await handleToolCalls(calls, messages, emit, baseOpts);
    expect(runToolByName).not.toHaveBeenCalled();
    expect(summary.attempted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.lastFailure).toContain('missing path');
    const resultEvt = emit.mock.calls.find(
      (c) => c[0].kind === 'tool-result'
    )?.[0];
    expect(resultEvt?.kind).toBe('tool-result');
    if (resultEvt?.kind === 'tool-result') {
      expect(resultEvt.result.error).toBe('missing path');
    }
  });

  it('allows read with path through to toolRunner', async () => {
    runToolByName.mockResolvedValueOnce({
      id: 'c1',
      name: 'read',
      ok: true,
      output: 'ok',
      durationMs: 1
    });
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'read', argumentsBuf: '{"path":"README.md"}' }
    ];
    const summary = await handleToolCalls(calls, messages, emit, baseOpts);
    expect(runToolByName).toHaveBeenCalledOnce();
    expect(summary.failed).toBe(0);
  });
});
