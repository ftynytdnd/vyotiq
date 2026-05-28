/**
 * Regression tests for audit fixes A1, A2, D1 in
 * `applyTimelineEvent.ts`'s sub-agent reducer branches.
 *
 *   A1 — `subagent-pending` for an id whose existing snapshot is
 *        TERMINAL must reset the snapshot cleanly (new task / files /
 *        tools / steps / fileEdits / streaming bodies). Pre-fix, the
 *        reducer early-returned and the new round silently merged
 *        into the previous round's body.
 *
 *   A2 — `subagent-spawn` now carries `tools` directly. The reducer
 *        prefers the spawn's list when non-empty but falls back to a
 *        prior `subagent-pending`'s list when the directive omitted
 *        the attribute on spawn but populated it on pending.
 *
 *   D1 — sub-agent-scoped `agent-text-aborted` must scrub the
 *        matching streaming-delta events from `state.events` so a
 *        future `rebuildTimelineState` cannot resurrect the dropped
 *        body. Pre-fix, only the snapshot's accumulators were
 *        cleared; the events stayed and re-materialized on rebuild.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

const baseState: TimelineState = INITIAL_TIMELINE_STATE;

describe('audit A1 — subagent-pending re-use semantics', () => {
  it('resets the snapshot when the existing id is terminal (done)', () => {
    let s: TimelineState = baseState;

    // Round 1 lands and finishes successfully.
    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p1', ts: 1,
      subagentId: 'A1',
      task: 'Round 1 task',
      files: ['a.ts'],
      tools: ['read']
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'sp1', ts: 2,
      subagentId: 'A1',
      task: 'Round 1 task',
      files: ['a.ts'],
      tools: ['read']
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-status',
      id: 'st1', ts: 3,
      subagentId: 'A1',
      status: 'done'
    });

    // Round 2 reuses id A1 with completely different task/files/tools.
    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p2', ts: 10,
      subagentId: 'A1',
      task: 'Round 2 task',
      files: ['b.ts', 'c.ts'],
      tools: ['edit', 'bash']
    });

    const snap = s.subagents['A1'];
    expect(snap).toBeTruthy();
    expect(snap?.task).toBe('Round 2 task');
    expect(snap?.files).toEqual(['b.ts', 'c.ts']);
    expect(snap?.tools).toEqual(['edit', 'bash']);
    expect(snap?.status).toBe('pending');
    expect(snap?.steps).toEqual([]);
    expect(snap?.fileEdits).toEqual([]);
    expect(snap?.assistantTexts).toEqual({});
    expect(snap?.reasoningTexts).toEqual({});
    expect(snap?.iterationOrder).toEqual([]);
    // startedAt updates to the new round's timestamp.
    expect(snap?.startedAt).toBe(10);
  });

  it('resets the snapshot when the existing id is terminal (partial)', () => {
    let s: TimelineState = baseState;

    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p1', ts: 1,
      subagentId: 'A1',
      task: 'Round 1 task',
      files: ['a.ts'],
      tools: ['read']
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'sp1', ts: 2,
      subagentId: 'A1',
      task: 'Round 1 task',
      files: ['a.ts'],
      tools: ['read']
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-status',
      id: 'st1', ts: 3,
      subagentId: 'A1',
      status: 'partial'
    });

    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p2', ts: 10,
      subagentId: 'A1',
      task: 'Round 2 task',
      files: ['b.ts'],
      tools: ['edit']
    });

    const snap = s.subagents['A1'];
    expect(snap?.task).toBe('Round 2 task');
    expect(snap?.files).toEqual(['b.ts']);
    expect(snap?.status).toBe('pending');
    expect(snap?.steps).toEqual([]);
  });

  it('drops a re-pending when the existing snapshot is still running (no churn)', () => {
    let s: TimelineState = baseState;

    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p1', ts: 1,
      subagentId: 'A1',
      task: 'Original',
      files: [],
      tools: []
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'sp1', ts: 2,
      subagentId: 'A1',
      task: 'Original',
      files: [],
      tools: []
    });
    const beforeRunning = s;

    // Re-pending while running must be a no-op (audit A7).
    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p2', ts: 3,
      subagentId: 'A1',
      task: 'Should not overwrite',
      files: [],
      tools: []
    });

    // Reference equality: nothing changed.
    expect(s).toBe(beforeRunning);
    expect(s.subagents['A1']?.task).toBe('Original');
    expect(s.subagents['A1']?.status).toBe('running');
  });
});

describe('audit A2 — subagent-spawn carries tools', () => {
  it('uses the spawn event\'s tools when populated', () => {
    let s: TimelineState = baseState;
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'sp', ts: 1,
      subagentId: 'A1',
      task: 't',
      files: [],
      tools: ['read', 'search']
    });
    expect(s.subagents['A1']?.tools).toEqual(['read', 'search']);
  });

  it('falls back to a prior pending\'s tools when spawn carries an empty list', () => {
    let s: TimelineState = baseState;
    s = applyTimelineEvent(s, {
      kind: 'subagent-pending',
      id: 'p', ts: 1,
      subagentId: 'A1',
      task: 't',
      files: [],
      tools: ['edit']
    });
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'sp', ts: 2,
      subagentId: 'A1',
      task: 't',
      files: [],
      tools: [] // empty — fallback should kick in
    });
    expect(s.subagents['A1']?.tools).toEqual(['edit']);
  });

  it('handles legacy spawn events that lack the tools field entirely', () => {
    // Pre-A2 persisted transcripts have no `tools` slot. The reducer
    // must defend with the optional-chain so transcript replay does
    // not throw on legacy data.
    let s: TimelineState = baseState;
    const legacySpawn = {
      kind: 'subagent-spawn',
      id: 'sp', ts: 1,
      subagentId: 'A1',
      task: 't',
      files: []
      // tools intentionally omitted — pre-A2 wire shape
    } as unknown as TimelineEvent;
    expect(() => {
      s = applyTimelineEvent(s, legacySpawn);
    }).not.toThrow();
    expect(s.subagents['A1']?.tools).toEqual([]);
  });
});

describe('audit D1 — sub-agent agent-text-aborted scrubs events', () => {
  /*
   * Important: live `applyTimelineEvent` for sub-agent-scoped streaming
   * deltas does NOT push them onto `state.events` — the snapshot's
   * per-iteration accumulator is the authoritative render surface
   * (see the comment on `applySubagentStreamingEvent`). They DO get
   * persisted to the JSONL transcript by `chat.ipc.ts`, and on
   * transcript reload `rebuildTimelineState` walks them through the
   * same reducer. The D1 contract is: when an abort lands, scrub any
   * matching deltas FROM `state.events` so a SECOND pass through
   * `rebuildTimelineState` (or any consumer that walks `events`)
   * doesn't see ghost deltas.
   *
   * We construct synthetic transcripts and rebuild from them, since
   * that's the codepath the fix protects.
   */

  it('rebuild from a transcript containing deltas + abort produces a clean snapshot', () => {
    const transcript: TimelineEvent[] = [
      {
        kind: 'subagent-pending',
        id: 'p', ts: 1,
        subagentId: 'A1',
        task: 't', files: [], tools: []
      },
      { kind: 'agent-text-delta', id: 'iter-1', ts: 2, delta: 'partial body', subagentId: 'A1' },
      { kind: 'agent-reasoning-delta', id: 'iter-1', ts: 3, delta: 'partial reasoning', subagentId: 'A1' },
      { kind: 'agent-text-aborted', id: 'iter-1', ts: 4, subagentId: 'A1' }
    ];
    const rebuilt = rebuildTimelineState(transcript);
    // Snapshot accumulators are cleared.
    expect(rebuilt.subagents['A1']?.assistantTexts['iter-1']).toBeUndefined();
    expect(rebuilt.subagents['A1']?.reasoningTexts['iter-1']).toBeUndefined();
    expect(rebuilt.subagents['A1']?.iterationOrder).not.toContain('iter-1');
    // Audit fix D1: the events array no longer carries the dropped
    // deltas, so a second-pass rebuild remains stable.
    const remaining = rebuilt.events.filter(
      (e) =>
        (e.kind === 'agent-text-delta' || e.kind === 'agent-reasoning-delta') &&
        'subagentId' in e && e.subagentId === 'A1' &&
        e.id === 'iter-1'
    );
    expect(remaining).toEqual([]);
  });

  it('abort scoped to one worker does not nuke a sibling worker\'s body', () => {
    // Two workers stream simultaneously; aborting A1 must not affect
    // A2's snapshot. (Sub-agent deltas live only in the snapshot map,
    // not `state.events` — the snapshot is the authoritative render
    // surface, see `applySubagentStreamingEvent` doc-comment.)
    const transcript: TimelineEvent[] = [
      {
        kind: 'subagent-pending',
        id: 'p1', ts: 1,
        subagentId: 'A1',
        task: 't', files: [], tools: []
      },
      {
        kind: 'subagent-pending',
        id: 'p2', ts: 1,
        subagentId: 'A2',
        task: 't', files: [], tools: []
      },
      { kind: 'agent-text-delta', id: 'iter-1', ts: 2, delta: 'A1 body', subagentId: 'A1' },
      { kind: 'agent-text-delta', id: 'iter-1', ts: 2, delta: 'A2 body', subagentId: 'A2' },
      { kind: 'agent-text-aborted', id: 'iter-1', ts: 3, subagentId: 'A1' }
    ];
    const rebuilt = rebuildTimelineState(transcript);
    // A2 snapshot still has its body.
    expect(rebuilt.subagents['A2']?.assistantTexts['iter-1']?.text).toBe('A2 body');
    expect(rebuilt.subagents['A2']?.iterationOrder).toContain('iter-1');
    // A1 snapshot was cleared.
    expect(rebuilt.subagents['A1']?.assistantTexts['iter-1']).toBeUndefined();
    expect(rebuilt.subagents['A1']?.iterationOrder).not.toContain('iter-1');
  });
});
