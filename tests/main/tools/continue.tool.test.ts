/**
 * `continue` tool — enqueues steering self-prompts for async loop iteration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@main/tools/types.js';
import { DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT } from '@main/orchestrator/loop/dynamicLoopAudit.js';

const enqueueFollowUpMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));
const getActiveRunSelectionMock = vi.hoisted(() => vi.fn());

vi.mock('@main/followUps/followUpQueueService.js', () => ({
  enqueueFollowUp: (...args: unknown[]) => enqueueFollowUpMock(...args)
}));

vi.mock('@main/orchestrator/AgentV.js', () => ({
  getActiveRunSelectionForConversation: (...args: unknown[]) =>
    getActiveRunSelectionMock(...args)
}));

import { continueTool } from '@main/tools/continue.tool.js';

function ctx(): ToolContext {
  return {
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    signal: new AbortController().signal,
    emit: () => undefined
  };
}

describe('continue.tool', () => {
  beforeEach(() => {
    enqueueFollowUpMock.mockClear();
    getActiveRunSelectionMock.mockReset();
    getActiveRunSelectionMock.mockReturnValue({
      providerId: 'p1',
      modelId: 'm1',
      workspaceId: 'ws-1'
    });
  });

  it('enqueues default continue prompt on steering lane', async () => {
    const result = await continueTool.run({}, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/enqueued/i);
    expect(enqueueFollowUpMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      kind: 'steering',
      prompt: DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT,
      selection: { providerId: 'p1', modelId: 'm1' },
      source: 'continue'
    });
  });

  it('uses custom prompt when provided', async () => {
    const custom = 'Run vitest and fix failures.';
    const result = await continueTool.run({ prompt: custom }, ctx());
    expect(result.ok).toBe(true);
    expect(enqueueFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: custom, source: 'continue' })
    );
  });

  it('fails when no active run selection exists', async () => {
    getActiveRunSelectionMock.mockReturnValue(null);
    const result = await continueTool.run({}, ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no active run selection');
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
  });

  it('surfaces enqueue failures', async () => {
    enqueueFollowUpMock.mockRejectedValue(new Error('lane full'));
    const result = await continueTool.run({}, ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('enqueue failed');
    expect(result.output).toMatch(/lane full/i);
  });
});
