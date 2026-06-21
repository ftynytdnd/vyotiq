/**
 * Conversation heartbeat service — steering when busy, dispatch when idle.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ConversationHeartbeat } from '@shared/types/conversationHeartbeat.js';
import { FollowUpQueueFullError } from '@shared/types/followUp.js';

const listActiveRunsMock = vi.hoisted(() => vi.fn((): Array<{ conversationId?: string }> => []));
const dispatchChatSendMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, conversationId: 'conv-1' }))
);
const enqueueFollowUpMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));
const touchHeartbeatMock = vi.hoisted(() => vi.fn(async () => undefined));
const deferHeartbeatMock = vi.hoisted(() => vi.fn(async () => undefined));
const detachHeartbeatMock = vi.hoisted(() => vi.fn(async () => true));
const listHeartbeatsMock = vi.hoisted(() => vi.fn(async (): Promise<ConversationHeartbeat[]> => []));

vi.mock('@main/orchestrator/AgentV.js', () => ({
  listActiveRuns: () => listActiveRunsMock()
}));

vi.mock('@main/ipc/chat.ipc.js', () => ({
  dispatchChatSend: (...args: unknown[]) => dispatchChatSendMock(...args)
}));

vi.mock('@main/followUps/followUpQueueService.js', () => ({
  enqueueFollowUp: (...args: unknown[]) => enqueueFollowUpMock(...args)
}));

vi.mock('@main/heartbeat/conversationHeartbeatStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/heartbeat/conversationHeartbeatStore.js')>();
  return {
    ...actual,
    listConversationHeartbeats: (...args: unknown[]) => listHeartbeatsMock(...args),
    touchConversationHeartbeat: (...args: unknown[]) => touchHeartbeatMock(...args),
    deferConversationHeartbeat: (...args: unknown[]) => deferHeartbeatMock(...args),
    detachConversationHeartbeat: (...args: unknown[]) => detachHeartbeatMock(...args)
  };
});

const notifyUiToastMock = vi.hoisted(() => vi.fn());

vi.mock('@main/ui/uiToast.js', () => ({
  notifyUiToast: (...args: unknown[]) => notifyUiToastMock(...args)
}));

import {
  runConversationHeartbeatTickForTests,
  startConversationHeartbeatService,
  stopConversationHeartbeatService
} from '@main/heartbeat/conversationHeartbeatService.js';

function sampleHeartbeat(): ConversationHeartbeat {
  const now = Date.now();
  return {
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    enabled: true,
    intervalMinutes: 7,
    wakePrompt: '<heartbeat_wake>Check status</heartbeat_wake>',
    selection: { providerId: 'p1', modelId: 'm1' },
    createdAt: now - 120_000,
    updatedAt: now,
    nextWakeAt: now - 60_000
  };
}

describe('conversation heartbeat service', () => {
  beforeEach(() => {
    listActiveRunsMock.mockReset();
    dispatchChatSendMock.mockClear();
    enqueueFollowUpMock.mockClear();
    touchHeartbeatMock.mockClear();
    deferHeartbeatMock.mockClear();
    detachHeartbeatMock.mockClear();
    notifyUiToastMock.mockClear();
    listHeartbeatsMock.mockReset();
    stopConversationHeartbeatService();
  });

  afterEach(() => {
    stopConversationHeartbeatService();
  });

  it('enqueues steering wake when conversation is busy', async () => {
    listHeartbeatsMock.mockResolvedValue([sampleHeartbeat()]);
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);

    await runConversationHeartbeatTickForTests();

    expect(enqueueFollowUpMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      kind: 'steering',
      prompt: '<heartbeat_wake>Check status</heartbeat_wake>',
      selection: { providerId: 'p1', modelId: 'm1' },
      source: 'heartbeat'
    });
    expect(dispatchChatSendMock).not.toHaveBeenCalled();
    expect(touchHeartbeatMock).toHaveBeenCalled();
  });

  it('dispatches a new run when conversation is idle', async () => {
    listHeartbeatsMock.mockResolvedValue([sampleHeartbeat()]);
    listActiveRunsMock.mockReturnValue([]);

    await runConversationHeartbeatTickForTests();

    expect(dispatchChatSendMock).toHaveBeenCalled();
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
    expect(touchHeartbeatMock).toHaveBeenCalled();
  });

  it('does not advance heartbeat when steering enqueue is full', async () => {
    listHeartbeatsMock.mockResolvedValue([sampleHeartbeat()]);
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    enqueueFollowUpMock.mockRejectedValue(new FollowUpQueueFullError('steering', 10));

    await runConversationHeartbeatTickForTests();

    expect(enqueueFollowUpMock).toHaveBeenCalled();
    expect(touchHeartbeatMock).not.toHaveBeenCalled();
    expect(deferHeartbeatMock).toHaveBeenCalled();
    expect(notifyUiToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        variant: 'info'
      })
    );
  });

  it('does not advance heartbeat when chat:send rejects unknown conversation', async () => {
    listHeartbeatsMock.mockResolvedValue([sampleHeartbeat()]);
    listActiveRunsMock.mockReturnValue([]);
    dispatchChatSendMock.mockResolvedValue({
      ok: false as const,
      kind: 'unknown-conversation' as const,
      conversationId: 'conv-1'
    });

    await runConversationHeartbeatTickForTests();

    expect(dispatchChatSendMock).toHaveBeenCalled();
    expect(touchHeartbeatMock).not.toHaveBeenCalled();
    expect(detachHeartbeatMock).toHaveBeenCalledWith('conv-1');
  });

  it('starts interval poller without throwing', () => {
    expect(() => startConversationHeartbeatService()).not.toThrow();
    stopConversationHeartbeatService();
  });
});
