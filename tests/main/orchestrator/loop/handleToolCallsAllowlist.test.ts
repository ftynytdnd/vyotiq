import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';
import type { ToolResult } from '@shared/types/tool';

const runToolByName = vi.fn(
  async (name: string): Promise<ToolResult> => ({
    id: `result-for-${name}`,
    name: name as ToolResult['name'],
    ok: true,
    output: `ran ${name}`,
    durationMs: 1
  })
);

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (name: string, args: Record<string, unknown>, ctx: unknown) =>
    runToolByName(name, args, ctx)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { AGENT_TOOLS } from '@main/tools/policy/agentTools';

describe('handleToolCalls allowlist', () => {
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

  it('runs allowed tools', async () => {
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'ls', argumentsBuf: '{"path":"."}' }
    ];
    const summary = await handleToolCalls(calls, messages, emit, {
      ...baseOpts,
      allowlist: AGENT_TOOLS
    });
    expect(runToolByName).toHaveBeenCalledWith('ls', expect.any(Object), expect.any(Object));
    expect(summary.attempted).toBe(1);
    expect(messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('refuses tools outside a custom allowlist', async () => {
    const onToolCallSettled = vi.fn();
    const calls: PartialToolCall[] = [
      { id: 'c1', name: 'bash', argumentsBuf: '{"command":"ls"}' }
    ];
    const summary = await handleToolCalls(calls, messages, emit, {
      ...baseOpts,
      allowlist: ['ls'],
      onToolCallSettled
    });
    expect(runToolByName).not.toHaveBeenCalled();
    expect(summary.attempted).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('tool');
    expect(onToolCallSettled).toHaveBeenCalledTimes(1);
  });
});
