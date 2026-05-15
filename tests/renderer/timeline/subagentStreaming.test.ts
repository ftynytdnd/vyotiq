/**
 * Sub-agent streaming reducer routing — Audit fix §1.1.
 *
 * Locks down the contract that `agent-text-delta` /
 * `agent-text-end` / `agent-text-aborted` / `agent-reasoning-delta` /
 * `agent-reasoning-end` events with a `subagentId` slot land in the
 * matching `SubAgentSnapshot`'s per-iteration accumulators rather
 * than the top-level state slots, AND that orchestrator-scoped
 * events (no `subagentId`) keep their original behavior so the
 * existing assistant-text + reasoning panels never see a regression.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';

const SPAWN: TimelineEvent = {
  kind: 'subagent-spawn',
  id: 'spawn',
  ts: 1_000,
  subagentId: 'S1',
  task: 'probe the codebase',
  files: [],
  tools: []
};

const STATUS_DONE: TimelineEvent = {
  kind: 'subagent-status',
  id: 'st',
  ts: 5_000,
  subagentId: 'S1',
  status: 'done'
};

function delta(
  kind: 'agent-text-delta' | 'agent-reasoning-delta',
  id: string,
  delta: string,
  opts: { subagentId?: string; ts?: number; eventId?: string } = {}
): TimelineEvent {
  return {
    kind,
    id,
    ts: opts.ts ?? 2_000,
    delta,
    ...(opts.subagentId ? { subagentId: opts.subagentId } : {})
  } as TimelineEvent;
}

describe('applyTimelineEvent — sub-agent streaming (§1.1)', () => {
  it('routes sub-agent agent-text-delta into the matching snapshot, not top-level', () => {
    let s: TimelineState = applyTimelineEvent(INITIAL_TIMELINE_STATE, SPAWN);
    s = applyTimelineEvent(
      s,
      delta('agent-text-delta', 'iter-1', 'hello ', { subagentId: 'S1' })
    );
    s = applyTimelineEvent(
      s,
      delta('agent-text-delta', 'iter-1', 'world', { subagentId: 'S1' })
    );
    expect(s.assistantTexts).toEqual({});
    const snap = s.subagents['S1'];
    expect(snap).toBeDefined();
    expect(snap!.assistantTexts['iter-1']).toMatchObject({
      id: 'iter-1',
      text: 'hello world',
      done: false
    });
    expect(snap!.iterationOrder).toEqual(['iter-1']);
  });

  it('routes sub-agent reasoning into snapshot.reasoningTexts and stamps startedAt', () => {
    let s: TimelineState = applyTimelineEvent(INITIAL_TIMELINE_STATE, SPAWN);
    s = applyTimelineEvent(
      s,
      delta('agent-reasoning-delta', 'iter-1', 'pondering…', {
        subagentId: 'S1',
        ts: 1_500
      })
    );
    expect(s.reasoningTexts).toEqual({});
    const r = s.subagents['S1']!.reasoningTexts['iter-1']!;
    expect(r).toMatchObject({
      id: 'iter-1',
      text: 'pondering…',
      done: false,
      startedAt: 1_500
    });
  });

  it('agent-text-end on a sub-agent flips snapshot.assistantTexts[id].done without touching top-level', () => {
    let s: TimelineState = applyTimelineEvent(INITIAL_TIMELINE_STATE, SPAWN);
    s = applyTimelineEvent(
      s,
      delta('agent-text-delta', 'iter-1', 'partial', { subagentId: 'S1' })
    );
    s = applyTimelineEvent(s, {
      kind: 'agent-text-end',
      id: 'iter-1',
      ts: 3_000,
      subagentId: 'S1'
    });
    expect(s.subagents['S1']!.assistantTexts['iter-1']!.done).toBe(true);
    expect(s.assistantTexts).toEqual({});
  });

  it('agent-text-aborted on a sub-agent drops only the matching iteration', () => {
    let s: TimelineState = applyTimelineEvent(INITIAL_TIMELINE_STATE, SPAWN);
    s = applyTimelineEvent(
      s,
      delta('agent-text-delta', 'iter-1', 'doomed', { subagentId: 'S1' })
    );
    s = applyTimelineEvent(
      s,
      delta('agent-reasoning-delta', 'iter-2', 'separate', { subagentId: 'S1' })
    );
    s = applyTimelineEvent(s, {
      kind: 'agent-text-aborted',
      id: 'iter-1',
      ts: 3_500,
      subagentId: 'S1'
    });
    const snap = s.subagents['S1']!;
    expect(snap.assistantTexts['iter-1']).toBeUndefined();
    expect(snap.reasoningTexts['iter-2']).toBeDefined();
    expect(snap.iterationOrder).toEqual(['iter-2']);
  });

  it('orchestrator-scoped delta (no subagentId) still routes to top-level slots', () => {
    const s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      delta('agent-text-delta', 'orchestrator-msg', 'top-level')
    );
    expect(s.assistantTexts['orchestrator-msg']!.text).toBe('top-level');
    expect(s.subagents).toEqual({});
  });

  it('terminal subagent-status flips every open accumulator on the snapshot to done', () => {
    let s: TimelineState = applyTimelineEvent(INITIAL_TIMELINE_STATE, SPAWN);
    s = applyTimelineEvent(
      s,
      delta('agent-reasoning-delta', 'iter-1', 'r1', { subagentId: 'S1' })
    );
    s = applyTimelineEvent(
      s,
      delta('agent-text-delta', 'iter-1', 't1', { subagentId: 'S1' })
    );
    // No explicit `*-end` events emitted (e.g. the worker errored
    // out and `runSubAgent` returned through a non-streaming path).
    s = applyTimelineEvent(s, STATUS_DONE);
    const snap = s.subagents['S1']!;
    expect(snap.assistantTexts['iter-1']!.done).toBe(true);
    // Reasoning auto-closed when text started streaming for the same
    // id (parity with the orchestrator-level invariant), so its
    // `done` flag is already true; we just assert the result.
    expect(snap.reasoningTexts['iter-1']!.done).toBe(true);
  });

  it('rebuildTimelineState replays a persisted sub-agent stream into the matching snapshot', () => {
    const persisted: TimelineEvent[] = [
      SPAWN,
      delta('agent-reasoning-delta', 'iter-1', 'why', { subagentId: 'S1' }),
      delta('agent-text-delta', 'iter-1', 'answer', { subagentId: 'S1' }),
      { kind: 'agent-text-end', id: 'iter-1', ts: 3_000, subagentId: 'S1' },
      STATUS_DONE
    ];
    const s = rebuildTimelineState(persisted);
    const snap = s.subagents['S1']!;
    expect(snap.assistantTexts['iter-1']!.text).toBe('answer');
    expect(snap.assistantTexts['iter-1']!.done).toBe(true);
    expect(snap.reasoningTexts['iter-1']!.text).toBe('why');
    expect(s.assistantTexts).toEqual({});
    expect(s.reasoningTexts).toEqual({});
  });
});
