import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';
import { __test_resetEditFailureTracker } from '@main/orchestrator/editFailureTracker';

const runToolByName = vi.fn();

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (...args: unknown[]) => runToolByName(...args)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants';

describe('handleToolCalls pre-dispatch validation', () => {
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

  it('truncates large tool output in LLM context messages', async () => {
    const huge = 'y'.repeat(MAX_TOOL_OUTPUT_CHARS + 1000);
    runToolByName.mockResolvedValueOnce({
      id: 'c1',
      name: 'read',
      ok: true,
      output: huge,
      durationMs: 1
    });
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'read', argumentsBuf: '{"path":"big.txt"}' }
    ];
    await handleToolCalls(calls, messages, emit, baseOpts);
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(typeof toolMsg?.content).toBe('string');
    expect((toolMsg?.content as string).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(toolMsg?.content).toContain('…[truncated]');
    const resultEvt = emit.mock.calls.find((c) => c[0].kind === 'tool-result')?.[0];
    if (resultEvt?.kind === 'tool-result') {
      expect(resultEvt.result.output).toBe(huge);
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

  it('blocks edit on third identical no-match anchor without dispatching toolRunner', async () => {
    const controller = new AbortController();
    __test_resetEditFailureTracker(controller.signal);
    const opts = { ...baseOpts, signal: controller.signal };
    const editArgs = '{"path":"src/foo.ts","oldString":"stale","newString":"fresh"}';
    const noMatch = {
      id: 'edit-1',
      name: 'edit' as const,
      ok: false,
      output: '`oldString` not found in src/foo.ts',
      error: 'no match',
      durationMs: 1
    };
    runToolByName.mockResolvedValue(noMatch);

    const call = (): PartialToolCall[] => [
      { id: `c-${runToolByName.mock.calls.length}`, name: 'edit', argumentsBuf: editArgs }
    ];

    const first = await handleToolCalls(call(), messages, emit, opts);
    expect(runToolByName).toHaveBeenCalledTimes(1);
    expect(first.failed).toBe(1);
    expect(first.duplicateFailures).toBe(0);

    const second = await handleToolCalls(call(), messages, emit, opts);
    expect(runToolByName).toHaveBeenCalledTimes(2);
    expect(second.failed).toBe(1);
    expect(second.duplicateFailures).toBe(0);

    const third = await handleToolCalls(call(), messages, emit, opts);
    expect(runToolByName).toHaveBeenCalledTimes(2);
    expect(third.failed).toBe(1);
    expect(third.duplicateFailures).toBe(0);
    expect(third.lastFailure).toContain('edit_no_match_repeat');

    const blockedEvt = emit.mock.calls
      .map((c) => c[0])
      .filter((e): e is Extract<TimelineEvent, { kind: 'tool-result' }> => e.kind === 'tool-result')
      .at(-1);
    expect(blockedEvt?.result.error).toBe('edit_no_match_repeat');
  });
});
