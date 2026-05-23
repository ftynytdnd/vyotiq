/**
 * Tests for the `subagent-pending` reducer branch and inline
 * `subagent-line` timeline rows rendered by `SubAgentTrace`.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { applyTimelineEvent, rebuildTimelineState } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const PENDING: TimelineEvent = {
  kind: 'subagent-pending',
  id: 'p1',
  ts: 1000,
  subagentId: 'A1',
  task: 'Read src/index.ts',
  files: ['src/index.ts'],
  tools: []
};

const SPAWN: TimelineEvent = {
  kind: 'subagent-spawn',
  id: 's1',
  ts: 1500,
  subagentId: 'A1',
  task: 'Read src/index.ts',
  files: ['src/index.ts'],
  tools: []
};

describe('applyTimelineEvent — subagent-pending', () => {
  it('materialises a snapshot in pending status', () => {
    const next = applyTimelineEvent(INITIAL_TIMELINE_STATE, PENDING);
    expect(next.subagents['A1']).toMatchObject({
      id: 'A1',
      status: 'pending',
      task: 'Read src/index.ts',
      files: ['src/index.ts']
    });
  });

  it('transitions pending → running on subagent-spawn without losing state', () => {
    const afterPending = applyTimelineEvent(INITIAL_TIMELINE_STATE, PENDING);
    const afterSpawn = applyTimelineEvent(afterPending, SPAWN);
    expect(afterSpawn.subagents['A1']).toMatchObject({
      id: 'A1',
      status: 'running',
      task: 'Read src/index.ts'
    });
    expect(afterSpawn.subagents['A1']?.startedAt).toBe(PENDING.ts);
  });

  it('does not regress a running snapshot if a stray pending arrives later', () => {
    const after = rebuildTimelineState([PENDING, SPAWN, PENDING]);
    expect(after.subagents['A1']?.status).toBe('running');
  });
});

describe('deriveRows — subagent-line rows', () => {
  it('emits one subagent-line row for pending + spawn events', () => {
    const rows = deriveRows([
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      PENDING,
      SPAWN
    ]);
    const subRows = rows.filter((r) => r.kind === 'subagent-line');
    expect(subRows).toHaveLength(1);
    expect(subRows[0]).toMatchObject({ subagentId: 'A1', key: 'sub:A1' });
  });

  it('emits subagent-line for pending without spawn', () => {
    const rows = deriveRows([
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      PENDING
    ]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });
});
