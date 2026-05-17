/**
 * Review finding H3 — orphan `subagent-pending` events MUST be dropped
 * before the renderer (or any consumer) materializes them as sub-agent
 * rows. The mid-stream directive parser in `handleAssistantTurn` emits
 * `subagent-pending` the instant a `<delegate />` is detected; the
 * matching `subagent-spawn` only fires once `handleDelegates` reaches
 * the verification phase. A run aborted between those two events
 * persists an orphan pending in the JSONL — without this filter, the
 * renderer's reducer paints a phantom sub-agent on conversation reload
 * that never resolves.
 *
 * The contract is enforced inside `readConversation` so every consumer
 * (renderer load, recall tool, rewind preview) sees a clean event
 * stream. The raw `readTranscript` continues to return the on-disk
 * truth for diagnostic / migration callers.
 */

import { describe, expect, it } from 'vitest';
import { dropOrphanPendingSubagents } from '@main/conversations/conversationStore';
import type { TimelineEvent } from '@shared/types/chat';

function pending(id: string, subagentId: string, ts = 0): TimelineEvent {
  return {
    kind: 'subagent-pending',
    id,
    ts,
    subagentId,
    task: 't',
    files: [],
    tools: []
  };
}

function spawn(id: string, subagentId: string, ts = 0): TimelineEvent {
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

describe('dropOrphanPendingSubagents', () => {
  it('returns the input unchanged when there are no pending events', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u', ts: 0, content: 'hello' },
      spawn('s', 'A1', 1)
    ];
    const out = dropOrphanPendingSubagents(events);
    // Reference equality preserved on the steady-state fast path.
    expect(out).toBe(events);
  });

  it('returns the input unchanged when every pending has a matching spawn', () => {
    const events: TimelineEvent[] = [
      pending('p', 'A1', 1),
      spawn('s', 'A1', 2)
    ];
    const out = dropOrphanPendingSubagents(events);
    expect(out).toBe(events);
    expect(out).toHaveLength(2);
  });

  it('drops a single orphan pending', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u', ts: 0, content: 'hi' },
      pending('p', 'A1', 1),
      // No subagent-spawn for A1 — run aborted mid-stream.
      { kind: 'error', id: 'e', ts: 2, message: 'aborted' }
    ];
    const out = dropOrphanPendingSubagents(events);
    expect(out).not.toBe(events);
    expect(out.find((e) => e.kind === 'subagent-pending')).toBeUndefined();
    // Non-pending events flow through unchanged.
    expect(out.map((e) => e.kind)).toEqual(['user-prompt', 'error']);
  });

  it('drops orphans selectively (mixed transcript)', () => {
    const events: TimelineEvent[] = [
      pending('p1', 'A1', 1),
      spawn('s1', 'A1', 2),               // A1 paired
      pending('p2', 'A2', 3),             // A2 orphan
      pending('p3', 'A3', 4),
      spawn('s3', 'A3', 5),               // A3 paired
      pending('p4', 'A4', 6)              // A4 orphan
    ];
    const out = dropOrphanPendingSubagents(events);
    // Two orphans should be dropped, two pending events kept.
    const kept = out.filter((e) => e.kind === 'subagent-pending') as Array<
      Extract<TimelineEvent, { kind: 'subagent-pending' }>
    >;
    expect(kept.map((e) => e.subagentId)).toEqual(['A1', 'A3']);
    // Spawn events untouched.
    const spawns = out.filter((e) => e.kind === 'subagent-spawn');
    expect(spawns).toHaveLength(2);
  });

  it('preserves event order across the filter', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u', ts: 0, content: 'a' },
      pending('p', 'A1', 1),                                      // orphan, dropped
      { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'hi' },
      pending('p2', 'A2', 3),                                     // paired below
      spawn('s', 'A2', 4),
      { kind: 'agent-text-end', id: 'a1', ts: 5 }
    ];
    const out = dropOrphanPendingSubagents(events);
    expect(out.map((e) => e.kind)).toEqual([
      'user-prompt',
      'agent-text-delta',
      'subagent-pending',  // A2 only
      'subagent-spawn',
      'agent-text-end'
    ]);
  });

  it('treats an empty event list as a no-op', () => {
    const events: TimelineEvent[] = [];
    expect(dropOrphanPendingSubagents(events)).toBe(events);
  });

  it('handles a transcript with only orphans', () => {
    const events: TimelineEvent[] = [
      pending('p1', 'A1', 1),
      pending('p2', 'A2', 2),
      pending('p3', 'A3', 3)
    ];
    const out = dropOrphanPendingSubagents(events);
    expect(out).toHaveLength(0);
  });
});
