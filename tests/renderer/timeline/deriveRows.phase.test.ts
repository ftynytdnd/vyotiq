import { describe, expect, it } from 'vitest';
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows — legacy phase events', () => {
  it('normalized legacy transcripts omit phase events before derive', () => {
    const events = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'phase', id: 'ph1', ts: 2, label: 'Plan' },
      { kind: 'phase-gate', id: 'g1', ts: 3, runId: 'r1', subtaskId: 's1', seq: 1, phase: 'plan', exitCriteria: 'done', gateDecision: { kind: 'passed', reason: 'ok' } },
      { kind: 'phase-ledger-entry', id: 'l1', ts: 4, runId: 'r1', subtaskId: 's1', seq: 1, phase: 'plan' }
    ] as unknown as TimelineEvent[];

    const normalized = normalizeLegacyTranscript(events);
    expect(normalized.some((e) => (e as { kind: string }).kind.startsWith('phase'))).toBe(false);
    expect(normalized.length).toBe(1);
  });
});
