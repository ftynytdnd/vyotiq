/**
 * Scheduled runs enqueue follow-ups when the target conversation is busy.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';
import { FollowUpQueueFullError } from '@shared/types/followUp.js';

const listActiveRunsMock = vi.hoisted(() => vi.fn((): Array<{ conversationId?: string }> => []));
const dispatchChatSendMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, conversationId: 'conv-1' })));
const enqueueFollowUpMock = vi.hoisted(() => vi.fn(async () => ({ steering: [], queued: [] })));
const touchScheduledRunMock = vi.hoisted(() => vi.fn(async () => undefined));
const listScheduledRunsMock = vi.hoisted(() => vi.fn(async (): Promise<ScheduledRun[]> => []));

vi.mock('@main/orchestrator/AgentV.js', () => ({
  listActiveRuns: () => listActiveRunsMock()
}));

vi.mock('@main/ipc/chat.ipc.js', () => ({
  dispatchChatSend: (...args: unknown[]) => dispatchChatSendMock(...args)
}));

vi.mock('@main/followUps/followUpQueueService.js', () => ({
  enqueueFollowUp: (...args: unknown[]) => enqueueFollowUpMock(...args)
}));

vi.mock('@main/scheduler/scheduledRunsStore.js', () => ({
  listScheduledRuns: (...args: unknown[]) => listScheduledRunsMock(...args),
  touchScheduledRun: (...args: unknown[]) => touchScheduledRunMock(...args)
}));

const notifyUiToastMock = vi.hoisted(() => vi.fn());

vi.mock('@main/ui/uiToast.js', () => ({
  notifyUiToast: (...args: unknown[]) => notifyUiToastMock(...args)
}));

import { startScheduledRunsService, stopScheduledRunsService } from '@main/scheduler/scheduledRunsService.js';

function sampleRun(): ScheduledRun {
  const now = Date.now();
  return {
    id: 'run-1',
    enabled: true,
    label: 'Heartbeat',
    workspaceId: 'ws-1',
    conversationId: 'conv-1',
    prompt: 'Check status',
    providerId: 'p1',
    modelId: 'm1',
    intervalMinutes: 60,
    createdAt: now - 120_000,
    updatedAt: now,
    nextRunAt: now - 60_000
  };
}

describe('scheduledRuns enqueue when busy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listActiveRunsMock.mockReset();
    dispatchChatSendMock.mockClear();
    enqueueFollowUpMock.mockClear();
    touchScheduledRunMock.mockClear();
    notifyUiToastMock.mockClear();
    listScheduledRunsMock.mockReset();
    stopScheduledRunsService();
  });

  afterEach(() => {
    stopScheduledRunsService();
    vi.useRealTimers();
  });

  it('enqueues instead of dispatching when conversation is busy', async () => {
    listScheduledRunsMock.mockResolvedValue([sampleRun()]);
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);

    startScheduledRunsService();
    await vi.runOnlyPendingTimersAsync();

    expect(enqueueFollowUpMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      kind: 'queue',
      prompt: 'Check status',
      selection: { providerId: 'p1', modelId: 'm1' },
      source: 'scheduled'
    });
    expect(dispatchChatSendMock).not.toHaveBeenCalled();
    expect(touchScheduledRunMock).toHaveBeenCalled();
  });

  it('dispatches immediately when conversation is idle', async () => {
    listScheduledRunsMock.mockResolvedValue([sampleRun()]);
    listActiveRunsMock.mockReturnValue([]);

    startScheduledRunsService();
    await vi.runOnlyPendingTimersAsync();

    expect(dispatchChatSendMock).toHaveBeenCalled();
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
  });

  it('does not advance schedule when enqueue fails because queue is full', async () => {
    listScheduledRunsMock.mockResolvedValue([sampleRun()]);
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    enqueueFollowUpMock.mockRejectedValue(new FollowUpQueueFullError('queue', 10));

    startScheduledRunsService();
    await vi.runOnlyPendingTimersAsync();

    expect(enqueueFollowUpMock).toHaveBeenCalled();
    expect(touchScheduledRunMock).not.toHaveBeenCalled();
    expect(notifyUiToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        variant: 'info'
      })
    );
  });

  it('toasts only once per due window when enqueue stays full', async () => {
    listScheduledRunsMock.mockResolvedValue([sampleRun()]);
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    enqueueFollowUpMock.mockRejectedValue(new FollowUpQueueFullError('queue', 10));

    startScheduledRunsService();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runOnlyPendingTimersAsync();

    expect(enqueueFollowUpMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(notifyUiToastMock).toHaveBeenCalledTimes(1);
    expect(touchScheduledRunMock).not.toHaveBeenCalled();
  });
});
