import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows error-terminated runs', () => {
  it('merges run stats into the error row and omits run-complete', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'hello' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2000, delta: 'hi' },
      {
        kind: 'error',
        id: 'e1',
        ts: 9400,
        message: 'OpenRouter: Insufficient balance.'
      }
    ];

    const rows = deriveRows(events);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('error');
    expect(kinds).not.toContain('run-complete');

    const errorRow = rows.find((r) => r.kind === 'error');
    expect(errorRow?.kind).toBe('error');
    if (errorRow?.kind !== 'error') return;
    expect(errorRow.durationMs).toBe(8400);
    expect(errorRow.completedAt).toBe(9400);
  });

  it('merges zero-duration error stats when the failure is instantaneous', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'hi' },
      { kind: 'error', id: 'e1', ts: 1000, message: 'OpenRouter: Insufficient balance.' }
    ];

    const rows = deriveRows(events);
    const errorRow = rows.find((r) => r.kind === 'error');
    expect(errorRow?.kind).toBe('error');
    if (errorRow?.kind !== 'error') return;
    expect(errorRow.durationMs).toBe(0);
    expect(errorRow.completedAt).toBe(1000);
    expect(rows.some((r) => r.kind === 'run-complete')).toBe(false);
  });
});
