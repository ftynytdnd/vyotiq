import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';

const runToolByName = vi.fn();

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (...args: unknown[]) => runToolByName(...args)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { AGENT_TOOLS } from '@main/tools/policy/agentTools';

describe('handleToolCalls finish intercept', () => {
  const events: TimelineEvent[] = [];
  const emit = (e: TimelineEvent) => events.push(e);
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
    events.length = 0;
    messages.length = 0;
  });

  it('settles finish without dispatching to the tool runner', async () => {
    const calls: PartialToolCall[] = [
      {
        id: 'tc-finish',
        name: 'functions.finish',
        argumentsBuf: JSON.stringify({ summary: 'Hello! How can I help you today?' })
      }
    ];
    const summary = await handleToolCalls(calls, messages, emit, {
      ...baseOpts,
      allowlist: AGENT_TOOLS
    });
    expect(runToolByName).not.toHaveBeenCalled();
    expect(summary.attempted).toBe(0);
    expect(events.filter((e) => e.kind === 'tool-call')).toHaveLength(1);
    const result = events.find((e) => e.kind === 'tool-result');
    expect(result && result.kind === 'tool-result' && result.result.ok).toBe(true);
    expect(
      result && result.kind === 'tool-result' && result.result.name === 'finish'
    ).toBe(true);
  });
});
