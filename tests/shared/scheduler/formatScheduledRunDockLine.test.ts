import { describe, expect, it } from 'vitest';
import {
  formatScheduledRunDockSubtitle,
  formatScheduledRunDueLine,
  formatScheduledRunInterval
} from '../../../src/shared/scheduler/formatScheduledRunDockLine.js';
import type { ScheduledRun } from '../../../src/shared/types/scheduledRun.js';

function baseRun(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    id: 'run-1',
    enabled: true,
    label: 'Nightly review',
    workspaceId: 'ws-1',
    conversationId: 'conv-1',
    prompt: 'Review open PRs',
    providerId: 'p1',
    modelId: 'm1',
    intervalMinutes: 60,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

describe('formatScheduledRunDockLine', () => {
  it('formats known intervals', () => {
    expect(formatScheduledRunInterval(60)).toBe('Hourly');
    expect(formatScheduledRunInterval(37)).toBe('Every 37 minutes');
  });

  it('formats due-now and due-in lines', () => {
    const now = 10_000;
    expect(formatScheduledRunDueLine(baseRun({ nextRunAt: 9_000 }), now)).toBe('Due now');
    expect(formatScheduledRunDueLine(baseRun({ nextRunAt: 16_000 }), now)).toBe('Due in 1m');
    expect(formatScheduledRunDueLine(baseRun({ enabled: false }), now)).toBe('Disabled');
  });

  it('builds dock subtitle', () => {
    const line = formatScheduledRunDockSubtitle(baseRun({ nextRunAt: 70_000 }), 10_000);
    expect(line).toContain('Hourly');
    expect(line).toContain('Due in');
  });
});
