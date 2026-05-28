import { describe, expect, it } from 'vitest';
import {
  applyDeriveRowsLiveLayer,
  deriveRows
} from '@renderer/components/timeline/reducer/deriveRows';

describe('applyDeriveRowsLiveLayer', () => {
  it('appends partial tool rows without re-deriving events', () => {
    const events = [
      {
        kind: 'user-prompt' as const,
        id: 'u1',
        ts: 1,
        content: 'hi',
        runId: 'r1'
      }
    ];
    const base = deriveRows(events, { runActive: true });
    const withPartial = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'read',
          index: 0,
          argsBuf: '{"path":"a.ts"}',
          parsed: { path: 'a.ts' },
          ts: 2
        }
      }
    });
    expect(withPartial.length).toBeGreaterThan(base.length);
    expect(withPartial.some((r) => r.kind === 'tool-group')).toBe(true);
  });
});
