import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';

const listActiveRunsMock = vi.hoisted(() =>
  vi.fn((): Array<{ conversationId?: string }> => [])
);

vi.mock('@main/orchestrator/AgentV.js', () => ({
  listActiveRuns: () => listActiveRunsMock()
}));

import { conversationHasActiveRun } from '@main/orchestrator/conversationHasActiveRun.js';
import { shouldDispatchScheduledRun } from '@main/scheduler/scheduledRunsService.js';

function sampleRun(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  const now = Date.now();
  return {
    id: 'run-1',
    enabled: true,
    label: 'Test',
    workspaceId: 'ws-1',
    conversationId: 'conv-1',
    prompt: 'Check status',
    providerId: 'p1',
    modelId: 'm1',
    intervalMinutes: 60,
    createdAt: now - 120_000,
    updatedAt: now,
    nextRunAt: now - 60_000,
    ...overrides
  };
}

describe('scheduledRunsService guards', () => {
  beforeEach(() => {
    listActiveRunsMock.mockReset();
    listActiveRunsMock.mockReturnValue([]);
  });

  it('conversationHasActiveRun returns true when a run is in flight', () => {
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    expect(conversationHasActiveRun('conv-1')).toBe(true);
    expect(conversationHasActiveRun('conv-2')).toBe(false);
  });

  it('shouldDispatchScheduledRun rejects disabled, empty prompt, and not-due runs', () => {
    const now = Date.now();
    expect(shouldDispatchScheduledRun(sampleRun({ enabled: false }), now)).toBe(false);
    expect(shouldDispatchScheduledRun(sampleRun({ prompt: '   ' }), now)).toBe(false);
    expect(
      shouldDispatchScheduledRun(sampleRun({ nextRunAt: now + 60_000 }), now)
    ).toBe(false);
  });

  it('shouldDispatchScheduledRun allows due enabled runs even when conversation is busy', () => {
    const now = Date.now();
    listActiveRunsMock.mockReturnValue([{ conversationId: 'conv-1' }]);
    expect(shouldDispatchScheduledRun(sampleRun(), now)).toBe(true);
  });

  it('shouldDispatchScheduledRun allows due enabled runs on idle conversations', () => {
    const now = Date.now();
    expect(shouldDispatchScheduledRun(sampleRun(), now)).toBe(true);
  });
});
