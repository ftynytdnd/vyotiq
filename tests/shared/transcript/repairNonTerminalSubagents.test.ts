/**
 * P0 — close non-terminal sub-agents on idle transcript load.
 *
 * After hard kill or aborted delegation, JSONL can contain
 * `subagent-spawn` without a terminal `subagent-status`. On reload
 * (when the conversation has no active run), synthetic aborted rows
 * must land before `rebuildTimelineState` so snapshots do not stick
 * at `running` / `pending`.
 */

import { describe, expect, it } from 'vitest';
import { rebuildTimelineState } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  nonTerminalSpawnedSubagentIds,
  repairNonTerminalSubagents
} from '@shared/transcript/repairNonTerminalSubagents';
import type { TimelineEvent } from '@shared/types/chat';

function spawn(id: string, subagentId: string, ts: number): TimelineEvent {
  return {
    kind: 'subagent-spawn',
    id,
    ts,
    subagentId,
    task: 't',
    files: [],
    tools: []
  };
}

function status(
  id: string,
  subagentId: string,
  status: 'done' | 'aborted' | 'failed',
  ts: number
): TimelineEvent {
  return {
    kind: 'subagent-status',
    id,
    ts,
    subagentId,
    status
  };
}

describe('repairNonTerminalSubagents', () => {
  it('returns the input unchanged when closeWhenIdle is false', () => {
    const events: TimelineEvent[] = [spawn('s', 'A1', 1)];
    const out = repairNonTerminalSubagents(events, { closeWhenIdle: false });
    expect(out).toBe(events);
  });

  it('returns the input unchanged when every spawn has a terminal status', () => {
    const events: TimelineEvent[] = [
      spawn('s', 'A1', 1),
      status('st', 'A1', 'done', 2)
    ];
    const out = repairNonTerminalSubagents(events, { closeWhenIdle: true });
    expect(out).toBe(events);
    expect(nonTerminalSpawnedSubagentIds(events)).toEqual([]);
  });

  it('appends synthetic aborted status for an open spawn', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u', ts: 0, content: 'hi' },
      spawn('s', 'A1', 1)
    ];
    const out = repairNonTerminalSubagents(events, { closeWhenIdle: true });
    expect(out).not.toBe(events);
    expect(out).toHaveLength(3);
    const repaired = out[2]!;
    expect(repaired.kind).toBe('subagent-status');
    if (repaired.kind === 'subagent-status') {
      expect(repaired.subagentId).toBe('A1');
      expect(repaired.status).toBe('aborted');
    }
  });

  it('closes only open spawns in a mixed transcript', () => {
    const events: TimelineEvent[] = [
      spawn('s1', 'A1', 1),
      status('d1', 'A1', 'done', 2),
      spawn('s2', 'A2', 3),
      spawn('s3', 'A3', 4),
      status('d3', 'A3', 'aborted', 5)
    ];
    const out = repairNonTerminalSubagents(events, { closeWhenIdle: true });
    const closed = out.filter(
      (e) => e.kind === 'subagent-status' && e.subagentId === 'A2'
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ status: 'aborted' });
    expect(nonTerminalSpawnedSubagentIds(out)).toEqual([]);
  });

  it('re-opens on re-spawn until a terminal status lands', () => {
    const events: TimelineEvent[] = [
      spawn('s1', 'A1', 1),
      status('d1', 'A1', 'aborted', 2),
      spawn('s2', 'A1', 3)
    ];
    expect(nonTerminalSpawnedSubagentIds(events)).toEqual(['A1']);
    const out = repairNonTerminalSubagents(events, { closeWhenIdle: true });
    expect(out[out.length - 1]).toMatchObject({
      kind: 'subagent-status',
      subagentId: 'A1',
      status: 'aborted'
    });
  });

  it('rebuildTimelineState leaves snapshots terminal after repair', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'subagent-pending',
        id: 'p',
        ts: 1,
        subagentId: 'A1',
        task: 't',
        files: [],
        tools: []
      },
      spawn('s', 'A1', 2),
      { kind: 'agent-text-delta', id: 'iter', ts: 3, delta: 'partial', subagentId: 'A1' }
    ];
    const repaired = repairNonTerminalSubagents(events, { closeWhenIdle: true });
    const rebuilt = rebuildTimelineState(repaired);
    expect(rebuilt.subagents['A1']?.status).toBe('aborted');
    expect(rebuilt.subagents['A1']?.endedAt).toBeDefined();
  });
});
