import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows — legacy phase events', () => {
  it('does not emit phase rows (stripped on load; no renderer cases)', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'phase', id: 'ph1', ts: 2, label: 'Plan' },
      {
        kind: 'phase-gate',
        id: 'g1',
        ts: 3,
        runId: 'r1',
        subtaskId: 's1',
        seq: 1,
        phase: 'plan',
        exitCriteria: 'done',
        gateDecision: { kind: 'passed', reason: 'ok' }
      },
      {
        kind: 'phase-ledger-entry',
        id: 'l1',
        ts: 4,
        runId: 'r1',
        subtaskId: 's1',
        seq: 1,
        phase: 'plan',
        exitCriteria: 'done'
      }
    ];

    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'phase-log' || r.kind === 'phase-ledger')).toBe(
      false
    );
  });

  it('normalized legacy transcripts omit phase events before derive', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'phase', id: 'ph1', ts: 2, label: 'Plan' }
    ];
    const normalized = normalizeLegacyTranscript(events);
    expect(normalized.some((e) => e.kind === 'phase')).toBe(false);
    expect(deriveRows(normalized).length).toBe(1);
  });
});
