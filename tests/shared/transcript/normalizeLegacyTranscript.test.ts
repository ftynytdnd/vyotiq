import { describe, expect, it } from 'vitest';
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript';
import type { TimelineEvent } from '@shared/types/chat';

describe('normalizeLegacyTranscript', () => {
  it('drops legacy worker lifecycle rows and strips subagentId from survivors', () => {
    const raw = [
      { kind: 'user-prompt', id: 'u1', ts: 1, content: 'hi' },
      {
        kind: 'subagent-spawn',
        id: 's1',
        ts: 2,
        subagentId: 'A1',
        task: 't',
        files: [],
        tools: []
      },
      {
        kind: 'tool-call',
        id: 't1',
        ts: 3,
        subagentId: 'A1',
        call: { id: 'c1', name: 'read', args: {} }
      }
    ] as TimelineEvent[];

    const out = normalizeLegacyTranscript(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe('user-prompt');
    expect(out[1]?.kind).toBe('tool-call');
    expect('subagentId' in (out[1] as object)).toBe(false);
  });

  it('drops legacy phased-execution rows', () => {
    const raw = [
      { kind: 'user-prompt', id: 'u1', ts: 1, content: 'hi' },
      { kind: 'phase', id: 'p1', ts: 2, name: 'plan' },
      { kind: 'phase-gate', id: 'g1', ts: 3, decision: 'continue' },
      { kind: 'phase-ledger-entry', id: 'l1', ts: 4, summary: 'done' },
      { kind: 'agent-text', id: 'a1', ts: 5, content: 'ok' }
    ] as TimelineEvent[];

    const out = normalizeLegacyTranscript(raw);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.kind)).toEqual(['user-prompt', 'agent-text']);
  });
});
