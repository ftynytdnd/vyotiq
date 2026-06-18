/**
 * Post-run follow-up drain — idle conversation dispatches next queued item.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const listActiveRunsMock = vi.hoisted(() => vi.fn((): Array<{ conversationId?: string }> => []));
const dispatchChatSendMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, conversationId: 'conv-1' })));
const getConversationMetaMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: 'conv-1', workspaceId: 'ws-1' }))
);
const takeQueuedFollowUpMock = vi.hoisted(() => vi.fn());
const peekQueuedFollowUpMock = vi.hoisted(() => vi.fn());
const removeFollowUpMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));
const listFollowUpsMock = vi.hoisted(() => vi.fn());
const restoreQueuedFollowUpAtHeadMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));
const enqueueFollowUpMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));

vi.mock('@main/orchestrator/AgentV.js', () => ({
  listActiveRuns: () => listActiveRunsMock(),
  findAllActiveRunsForConversation: vi.fn(() => []),
  abortRun: vi.fn()
}));

vi.mock('@main/ipc/chat.ipc.js', () => ({
  dispatchChatSend: (...args: unknown[]) => dispatchChatSendMock(...args)
}));

vi.mock('@main/conversations/conversationStore.js', () => ({
  getConversationMeta: (...args: unknown[]) => getConversationMetaMock(...args),
  drainAppendChain: vi.fn(async () => undefined)
}));

vi.mock('@main/ipc/runSettlement.js', () => ({
  awaitRunSettlement: vi.fn(async () => undefined)
}));

vi.mock('@main/followUps/followUpQueueService.js', () => ({
  peekQueuedFollowUp: (...args: unknown[]) => peekQueuedFollowUpMock(...args),
  takeQueuedFollowUp: (...args: unknown[]) => takeQueuedFollowUpMock(...args),
  restoreQueuedFollowUpAtHead: (...args: unknown[]) => restoreQueuedFollowUpAtHeadMock(...args),
  enqueueFollowUp: (...args: unknown[]) => enqueueFollowUpMock(...args),
  removeFollowUp: (...args: unknown[]) => removeFollowUpMock(...args),
  listFollowUps: (...args: unknown[]) => listFollowUpsMock(...args)
}));

vi.mock('@main/orchestrator/conversationHasActiveRun.js', () => ({
  conversationHasActiveRun: (conversationId: string) =>
    listActiveRunsMock().some((r) => r.conversationId === conversationId)
}));

import { drainFollowUpsForConversation, sendQueuedFollowUpNow } from '@main/followUps/drainFollowUps.js';

describe('drainFollowUpsForConversation', () => {
  beforeEach(() => {
    listActiveRunsMock.mockReturnValue([]);
    dispatchChatSendMock.mockClear();
    peekQueuedFollowUpMock.mockReset();
    takeQueuedFollowUpMock.mockReset();
    restoreQueuedFollowUpAtHeadMock.mockReset();
    enqueueFollowUpMock.mockClear();
    getConversationMetaMock.mockResolvedValue({ id: 'conv-1', workspaceId: 'ws-1' });
  });

  it('dispatches the head queued follow-up when conversation is idle', async () => {
    peekQueuedFollowUpMock.mockResolvedValue({
      id: 'q1',
      kind: 'queue',
      prompt: 'next task',
      selection: { providerId: 'p1', modelId: 'm1' },
      queuedAt: 1,
      source: 'composer'
    });
    takeQueuedFollowUpMock.mockResolvedValueOnce({
      id: 'q1',
      kind: 'queue',
      prompt: 'next task',
      selection: { providerId: 'p1', modelId: 'm1' },
      queuedAt: 1,
      source: 'composer'
    });

    await drainFollowUpsForConversation('conv-1');

    expect(dispatchChatSendMock).toHaveBeenCalledTimes(1);
    expect(dispatchChatSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
        prompt: 'next task',
        selection: { providerId: 'p1', modelId: 'm1' }
      })
    );
  });

  it('skips drain while conversation still has an active run', async () => {
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    peekQueuedFollowUpMock.mockResolvedValue({
      id: 'q1',
      kind: 'queue',
      prompt: 'next',
      selection: { providerId: 'p1', modelId: 'm1' },
      queuedAt: 1,
      source: 'composer'
    });

    await drainFollowUpsForConversation('conv-1');

    expect(dispatchChatSendMock).not.toHaveBeenCalled();
  });

  it('restores head item when dispatch fails', async () => {
    const item = {
      id: 'q1',
      kind: 'queue' as const,
      prompt: 'next task',
      selection: { providerId: 'p1', modelId: 'm1' },
      queuedAt: 1,
      source: 'composer' as const
    };
    peekQueuedFollowUpMock.mockResolvedValue(item);
    takeQueuedFollowUpMock.mockResolvedValueOnce(item);
    dispatchChatSendMock.mockRejectedValueOnce(new Error('dispatch failed'));

    await drainFollowUpsForConversation('conv-1');

    expect(restoreQueuedFollowUpAtHeadMock).toHaveBeenCalledWith('conv-1', item);
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
  });

  it('does not dequeue when conversation workspace is missing', async () => {
    getConversationMetaMock.mockResolvedValueOnce({ id: 'conv-1', workspaceId: undefined });
    peekQueuedFollowUpMock.mockResolvedValue({
      id: 'q1',
      kind: 'queue',
      prompt: 'next',
      selection: { providerId: 'p1', modelId: 'm1' },
      queuedAt: 1,
      source: 'composer'
    });

    await drainFollowUpsForConversation('conv-1');

    expect(takeQueuedFollowUpMock).not.toHaveBeenCalled();
    expect(removeFollowUpMock).not.toHaveBeenCalled();
  });
});

describe('sendQueuedFollowUpNow', () => {
  const target = {
    id: 'q-now',
    kind: 'queue' as const,
    prompt: 'send now task',
    selection: { providerId: 'p1', modelId: 'm1' },
    queuedAt: 1,
    source: 'composer' as const
  };

  beforeEach(() => {
    listActiveRunsMock.mockReturnValue([]);
    listFollowUpsMock.mockReset();
    removeFollowUpMock.mockReset();
    dispatchChatSendMock.mockClear();
    dispatchChatSendMock.mockResolvedValue({ ok: true as const, conversationId: 'conv-1' });
    listFollowUpsMock.mockResolvedValue({ steering: [], queued: [target] });
    removeFollowUpMock.mockResolvedValue({ steering: [], queued: [] });
  });

  it('dispatches without removing until dispatch succeeds', async () => {
    await sendQueuedFollowUpNow('conv-1', 'q-now');

    expect(dispatchChatSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
        prompt: 'send now task'
      })
    );
    expect(removeFollowUpMock).toHaveBeenCalledWith('conv-1', 'q-now');
  });

  it('keeps the queued item when dispatch fails', async () => {
    dispatchChatSendMock.mockRejectedValueOnce(new Error('dispatch failed'));

    await expect(sendQueuedFollowUpNow('conv-1', 'q-now')).rejects.toThrow('dispatch failed');
    expect(removeFollowUpMock).not.toHaveBeenCalled();
  });
});
