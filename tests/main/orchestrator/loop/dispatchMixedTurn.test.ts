/**
 * Mixed-turn DAG dispatcher — dependency batches and parallel fan-out.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ParsedDelegate } from '@main/orchestrator/envelope/index.js';

const handleToolCalls = vi.fn();
const handleDelegates = vi.fn();

vi.mock('@main/orchestrator/loop/handleToolCalls.js', () => ({
  handleToolCalls: (...args: unknown[]) => handleToolCalls(...args)
}));
vi.mock('@main/orchestrator/loop/handleDelegates.js', () => ({
  handleDelegates: (...args: unknown[]) => handleDelegates(...args)
}));

import { dispatchMixedTurn } from '@main/orchestrator/loop/dispatchMixedTurn.js';

function delegateSpec(id: string): ParsedDelegate {
  return { id, task: `task-${id}`, files: [], tools: ['read'] };
}

const baseToolOpts = {
  workspacePath: '/tmp/ws',
  workspaceId: 'ws-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  permissions: {},
  signal: new AbortController().signal,
  allowlist: ['read'] as const
};

const baseDelegateOpts = {
  selection: { providerId: 'p', modelId: 'm' },
  providerName: 'Test',
  workspacePath: '/tmp/ws',
  workspaceId: 'ws-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  permissions: {},
  signal: new AbortController().signal
};

const emptyCounters = {
  consecutiveBadRounds: 0,
  perTaskBadStreak: new Map<string, number>()
};

beforeEach(() => {
  handleToolCalls.mockReset();
  handleDelegates.mockReset();
  handleToolCalls.mockResolvedValue({ attempted: 1, failed: 0, childRedelegations: 0 });
  handleDelegates.mockResolvedValue(undefined);
});

describe('dispatchMixedTurn', () => {
  it('runs independent tools and delegates in one parallel batch', async () => {
    const messages: ChatMessage[] = [];
    const order: string[] = [];
    handleToolCalls.mockImplementation(async () => {
      order.push('tools');
      return { attempted: 1, failed: 0, childRedelegations: 0 };
    });
    handleDelegates.mockImplementation(async () => {
      order.push('delegates');
      return undefined;
    });

    await dispatchMixedTurn({
      continueTools: [{ id: 't1', name: 'read', argumentsBuf: '{}' }],
      delegateCalls: [{ toolCallId: 'd1', specs: [delegateSpec('w1')], dependsOn: [] }],
      messages,
      counters: emptyCounters,
      emit: vi.fn(),
      toolOpts: baseToolOpts,
      delegateOpts: baseDelegateOpts
    });

    expect(handleToolCalls).toHaveBeenCalledTimes(1);
    expect(handleDelegates).toHaveBeenCalledTimes(1);
    expect(order).toHaveLength(2);
  });

  it('runs depends_on batches sequentially', async () => {
    const messages: ChatMessage[] = [];
    const batches: string[] = [];
    handleToolCalls.mockImplementation(async (calls: { id?: string }[]) => {
      batches.push(calls.map((c) => c.id).join(','));
      return { attempted: 1, failed: 0, childRedelegations: 0 };
    });

    await dispatchMixedTurn({
      continueTools: [
        { id: 'a', name: 'read', argumentsBuf: '{}' },
        {
          id: 'b',
          name: 'read',
          argumentsBuf: JSON.stringify({ depends_on: ['a'] })
        }
      ],
      delegateCalls: [],
      messages,
      counters: emptyCounters,
      emit: vi.fn(),
      toolOpts: baseToolOpts,
      delegateOpts: baseDelegateOpts
    });

    expect(batches).toEqual(['a', 'b']);
  });

  it('runs multiple independent delegate calls in one parallel batch', async () => {
    const messages: ChatMessage[] = [];
    await dispatchMixedTurn({
      continueTools: [],
      delegateCalls: [
        { toolCallId: 'd1', specs: [delegateSpec('w1')], dependsOn: [] },
        { toolCallId: 'd2', specs: [delegateSpec('w2')], dependsOn: [] },
        { toolCallId: 'd3', specs: [delegateSpec('w3')], dependsOn: [] }
      ],
      messages,
      counters: emptyCounters,
      emit: vi.fn(),
      toolOpts: baseToolOpts,
      delegateOpts: baseDelegateOpts
    });

    expect(handleDelegates).toHaveBeenCalledTimes(1);
    const call = handleDelegates.mock.calls[0]!;
    const specs = call[0] as ParsedDelegate[];
    expect(specs.map((s) => s.id).sort()).toEqual(['w1', 'w2', 'w3']);
  });

  it('propagates halt from delegate batch', async () => {
    handleDelegates.mockResolvedValue('halt');
    const out = await dispatchMixedTurn({
      continueTools: [],
      delegateCalls: [{ toolCallId: 'd1', specs: [delegateSpec('w1')], dependsOn: [] }],
      messages: [],
      counters: emptyCounters,
      emit: vi.fn(),
      toolOpts: baseToolOpts,
      delegateOpts: baseDelegateOpts
    });
    expect(out.halt).toBe(true);
    expect(out.delegateRounds).toBe(1);
  });
});
