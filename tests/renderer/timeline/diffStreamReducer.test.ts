/**
 * Phase 2 — reducer branch for the `diff-stream` event.
 *
 * Pins:
 *   1. Orchestrator-scope `diff-stream` folds into
 *      `state.partialToolCallArgs[callId].diffStream`.
 *   2. Legacy `subagentId` on `diff-stream` still folds into
 *      `partialToolCallArgs[callId].diffStream` (stripped on transcript load).
 *   3. A `diff-stream` arriving BEFORE the first `tool-call-args-delta`
 *      seeds a minimal partial entry so the diff still renders.
 *   4. The matching authoritative `tool-call` event clears the
 *      partial entry — including the diffStream slot — so the
 *      live diff gives way to the settled tool-group child.
 *   5. `diff-stream` events do not produce a timeline row of their
 *      own (deriveRows skip path).
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';
import type { DiffHunk } from '@shared/types/tool';

const hunks: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: ' ', text: 'line one' },
      { kind: '-', text: 'line two' },
      { kind: '+', text: 'LINE TWO' },
      { kind: ' ', text: 'line three' }
    ]
  }
];

const diffStream = (
  callId: string,
  opts: { ts?: number; tool?: 'edit' | 'delete' | 'bash'; subagentId?: string } = {}
): Extract<TimelineEvent, { kind: 'diff-stream' }> => ({
  kind: 'diff-stream',
  id: `ds-${callId}-${opts.ts ?? 0}`,
  ts: opts.ts ?? 1,
  callId,
  tool: opts.tool ?? 'edit',
  filePath: 'a.ts',
  hunks,
  additions: 1,
  deletions: 1,
  ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
});

describe('applyTimelineEvent — diff-stream', () => {
  it('folds an orchestrator-scope diff-stream into partialToolCallArgs', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, diffStream('c1'));
    expect(s.partialToolCallArgs['c1']).toBeDefined();
    expect(s.partialToolCallArgs['c1']!.diffStream).toEqual({
      tool: 'edit',
      filePath: 'a.ts',
      hunks,
      additions: 1,
      deletions: 1,
      settled: false,
      ts: 1
    });
  });

  it('seeds a minimal partial entry when diff-stream arrives before any args-delta', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, diffStream('c1'));
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.argsBuf).toBe('');
    expect(entry.parsed).toBeNull();
    expect(entry.diffStream).toBeDefined();
  });

  it('preserves the existing partial-args entry when a diff-stream arrives later', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'tool-call-args-delta',
      id: 'd1',
      ts: 1,
      callId: 'c1',
      name: 'edit',
      index: 0,
      argsBuf: '{"path":"a.ts","oldString":"line two","newString":"LINE TWO"}'
    });
    expect(s.partialToolCallArgs['c1']!.parsed).toEqual({
      path: 'a.ts',
      oldString: 'line two',
      newString: 'LINE TWO'
    });
    s = applyTimelineEvent(s, diffStream('c1', { ts: 2 }));
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.argsBuf).toContain('oldString');
    expect(entry.parsed).toEqual({
      path: 'a.ts',
      oldString: 'line two',
      newString: 'LINE TWO'
    });
    expect(entry.diffStream).toBeDefined();
    expect(entry.diffStream!.hunks).toEqual(hunks);
  });

  it('preserves an existing diffStream when args-delta arrives after it', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, diffStream('c1', { ts: 1 }));
    s = applyTimelineEvent(s, {
      kind: 'tool-call-args-delta',
      id: 'd1',
      ts: 2,
      callId: 'c1',
      name: 'edit',
      index: 0,
      argsBuf: '{"path":"a.ts","oldString":"line two","newString":"LINE TWO"}'
    });
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.parsed).toEqual({
      path: 'a.ts',
      oldString: 'line two',
      newString: 'LINE TWO'
    });
    expect(entry.diffStream).toBeDefined();
    expect(entry.diffStream!.hunks).toEqual(hunks);
  });

  it('folds a legacy subagentId diff-stream into partialToolCallArgs', () => {
    const s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      diffStream('c1', { subagentId: 'sub-1', ts: 2 })
    );
    const entry = s.partialToolCallArgs['c1'];
    expect(entry).toBeDefined();
    expect(entry!.diffStream).toBeDefined();
    expect(entry!.diffStream!.hunks).toEqual(hunks);
  });

  it('preserves diffStream when args-delta arrives after diff-stream', () => {
    let s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      diffStream('c1', { subagentId: 'sub-1', ts: 2 })
    );
    s = applyTimelineEvent(s, {
      kind: 'tool-call-args-delta',
      id: 'd1',
      ts: 3,
      callId: 'c1',
      name: 'edit',
      index: 0,
      argsBuf: '{"path":"a.ts","oldString":"line two","newString":"LINE TWO"}',
      subagentId: 'sub-1'
    });
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.parsed).toEqual({
      path: 'a.ts',
      oldString: 'line two',
      newString: 'LINE TWO'
    });
    expect(entry.diffStream).toBeDefined();
    expect(entry.diffStream!.hunks).toEqual(hunks);
  });

  it('drops the partial entry (including diffStream) on the matching tool-call', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, diffStream('c1'));
    expect(s.partialToolCallArgs['c1']).toBeDefined();
    s = applyTimelineEvent(s, {
      kind: 'tool-call',
      id: 'evt-c1',
      ts: 5,
      call: {
        id: 'c1',
        name: 'edit',
        args: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' }
      }
    });
    expect(s.partialToolCallArgs['c1']).toBeUndefined();
  });

  it('surfaces settled=true when the streamer marks the snapshot as authoritative', () => {
    const ev: Extract<TimelineEvent, { kind: 'diff-stream' }> = {
      ...diffStream('c1', { ts: 3 }),
      settled: true
    };
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, ev);
    expect(s.partialToolCallArgs['c1']!.diffStream!.settled).toBe(true);
  });

  it('produces no row in deriveRows', () => {
    const rows = deriveRows([
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      diffStream('c1', { ts: 2 })
    ]);
    expect(rows.some((r) => r.kind === 'tool-group')).toBe(false);
  });

  it('flows the diffStream onto a synthesized partial tool-group child', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, diffStream('c1', { ts: 2 }));
    const rows = deriveRows([{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' }], {
      partialToolCallArgs: s.partialToolCallArgs
    });
    const tg = rows.find((r) => r.kind === 'tool-group');
    expect(tg).toBeDefined();
    if (tg?.kind !== 'tool-group') throw new Error('expected tool-group');
    expect(tg.children).toHaveLength(1);
    const child = tg.children[0]!;
    expect(child.partial).toBe(true);
    expect(child.diffStream).toEqual({
      tool: 'edit',
      filePath: 'a.ts',
      hunks,
      additions: 1,
      deletions: 1,
      settled: false,
      ts: 2
    });
  });
});
