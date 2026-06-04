/**
 * deriveRows — persisted phase log rows.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';

const USER: TimelineEvent = {
  kind: 'user-prompt',
  id: 'u1',
  ts: 0,
  content: 'go'
};

describe('deriveRows phase rows', () => {
  it('emits phase-log rows with label and tooltip in wire order', () => {
    const rows = deriveRows([
      USER,
      {
        kind: 'phase',
        id: 'p1',
        ts: 1,
        label: 'Spawning 2 workers…',
        tooltip: 'delegate pool fan-out'
      },
      {
        kind: 'phase',
        id: 'p2',
        ts: 2,
        label: 'Exploring'
      }
    ]);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'phase-log',
          id: 'p1',
          label: 'Spawning 2 workers…',
          tooltip: 'delegate pool fan-out'
        }),
        expect.objectContaining({
          kind: 'phase-log',
          id: 'p2',
          label: 'Exploring'
        })
      ])
    );
    const phaseIdx = rows.findIndex((r) => r.kind === 'phase-log' && r.id === 'p1');
    const userIdx = rows.findIndex((r) => r.kind === 'user-prompt');
    expect(phaseIdx).toBeGreaterThan(userIdx);
  });
});
