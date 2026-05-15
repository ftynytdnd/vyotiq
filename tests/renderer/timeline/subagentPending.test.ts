/**
 * Tests for the `subagent-pending` reducer branch and the matching
 * `subagent-line` row dedup in `deriveRows`.
 *
 * AUDIT §11.A — the headline live-visibility fix. A `subagent-pending`
 * event arrives mid-stream (the moment the orchestrator emits a
 * `<delegate />` directive); the matching `subagent-spawn` follows
 * later when the pool actually launches the worker. The renderer must:
 *   - materialise a snapshot in `pending` status on `subagent-pending`,
 *   - transition it to `running` on `subagent-spawn` without losing
 *     accumulated state,
 *   - emit a single `subagent-line` row dedup'd by `subagentId`.
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
    // startedAt was set by the pending event; spawn must not regress it.
    expect(afterSpawn.subagents['A1']?.startedAt).toBe(PENDING.ts);
  });

  it('does not regress a running snapshot if a stray pending arrives later', () => {
    const after = rebuildTimelineState([PENDING, SPAWN, PENDING]);
    expect(after.subagents['A1']?.status).toBe('running');
  });
});

describe('deriveRows — subagent-line dedup across pending and spawn', () => {
  it('emits a single subagent-line for one id even with both events', () => {
    const rows = deriveRows([
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      PENDING,
      SPAWN
    ]);
    const lines = rows.filter((r) => r.kind === 'subagent-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'subagent-line', subagentId: 'A1' });
  });

  it('emits one row even for a pending without a spawn (fail-soft)', () => {
    const rows = deriveRows([
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      PENDING
    ]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });
});
