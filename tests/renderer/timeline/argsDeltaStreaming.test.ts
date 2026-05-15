/**
 * Streaming partial-args lifecycle through `applyTimelineEvent`.
 *
 * Validates four invariants for the new `tool-call-args-delta` path:
 *   1. Each delta produces a snapshot keyed by `callId` with the
 *      parser's best-effort parse stored in `parsed`.
 *   2. Cumulative `argsBuf` semantics: the latest event for a callId
 *      supersedes earlier ones rather than concatenating.
 *   3. Reconciliation on the authoritative `tool-call` event: the
 *      matching partial entry is dropped (the live preview gives
 *      way to the settled row).
 *   4. Surrogate `pending:<owner>:<index>` callIds are reconciled
 *      to the real callId by index — the lowest-index surrogate
 *      is cleared first to handle parallel tool-call streams.
 *
 * Tests run the reducer directly so we don't pull in the React tree.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

const argsDelta = (
  callId: string,
  argsBuf: string,
  opts: { name?: string; index?: number; ts?: number; subagentId?: string } = {}
): Extract<TimelineEvent, { kind: 'tool-call-args-delta' }> => ({
  kind: 'tool-call-args-delta',
  id: `d-${callId}-${opts.ts ?? 0}`,
  ts: opts.ts ?? 1,
  callId,
  ...(opts.name !== undefined ? { name: opts.name } : {}),
  index: opts.index ?? 0,
  argsBuf,
  ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
});

describe('tool-call-args-delta — orchestrator-level', () => {
  it('populates partialToolCallArgs with the parsed snapshot', () => {
    const s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      argsDelta('c1', '{"path":"src/foo.ts"', { name: 'edit', index: 0, ts: 2 })
    );
    expect(s.partialToolCallArgs['c1']).toBeDefined();
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.argsBuf).toBe('{"path":"src/foo.ts"');
    expect(entry.parsed).toEqual({ path: 'src/foo.ts' });
    expect(entry.name).toBe('edit');
  });

  it('replaces (not concatenates) the entry on each subsequent delta', () => {
    let s = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(s, argsDelta('c1', '{"path":"sr', { name: 'edit', ts: 1 }));
    s = applyTimelineEvent(
      s,
      argsDelta('c1', '{"path":"src/foo.ts","oldString":"a"', { name: 'edit', ts: 2 })
    );
    const entry = s.partialToolCallArgs['c1']!;
    expect(entry.argsBuf).toBe('{"path":"src/foo.ts","oldString":"a"');
    expect(entry.parsed).toEqual({ path: 'src/foo.ts', oldString: 'a' });
  });

  it('drops the partial entry once the authoritative tool-call lands', () => {
    let s = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(s, argsDelta('c1', '{"path":"src/foo.ts"', { name: 'edit' }));
    expect(s.partialToolCallArgs['c1']).toBeDefined();
    s = applyTimelineEvent(s, {
      kind: 'tool-call',
      id: 'evt-c1',
      ts: 5,
      call: { id: 'c1', name: 'edit', args: { path: 'src/foo.ts' } }
    });
    expect(s.partialToolCallArgs['c1']).toBeUndefined();
  });

  it('reconciles a surrogate callId by clearing the lowest-index pending entry', () => {
    let s = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(
      s,
      argsDelta('pending:orc:0', '{"path":"a.ts"', { name: 'edit', index: 0 })
    );
    s = applyTimelineEvent(
      s,
      argsDelta('pending:orc:1', '{"path":"b.ts"', { name: 'edit', index: 1 })
    );
    expect(Object.keys(s.partialToolCallArgs).length).toBe(2);
    // First real tool-call lands — should drop the lowest-index
    // surrogate (the one that provider settled first).
    s = applyTimelineEvent(s, {
      kind: 'tool-call',
      id: 'evt-real-1',
      ts: 5,
      call: { id: 'real-1', name: 'edit', args: { path: 'a.ts' } }
    });
    expect(s.partialToolCallArgs['pending:orc:0']).toBeUndefined();
    expect(s.partialToolCallArgs['pending:orc:1']).toBeDefined();
  });

  it('clears all orchestrator partials on agent-text-aborted', () => {
    let s = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(
      s,
      argsDelta('pending:orc:0', '{"path":"a.ts"', { name: 'edit' })
    );
    s = applyTimelineEvent(s, {
      kind: 'agent-text-aborted',
      id: 'turn-1',
      ts: 5
    });
    expect(s.partialToolCallArgs).toEqual({});
  });
});

describe('tool-call-args-delta — replay safety', () => {
  it('rebuilds cleanly when persisted events do NOT include deltas', () => {
    // The new event kind is ephemeral — a JSONL replay never carries
    // it. Rebuilding the state from a real `tool-call` only must
    // leave `partialToolCallArgs` as `{}` (default initial state).
    const persisted: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      {
        kind: 'tool-call',
        id: 'evt-1',
        ts: 2,
        call: { id: 'c1', name: 'edit', args: { path: 'src/foo.ts' } }
      }
    ];
    const s = rebuildTimelineState(persisted);
    expect(s.partialToolCallArgs).toEqual({});
  });
});
