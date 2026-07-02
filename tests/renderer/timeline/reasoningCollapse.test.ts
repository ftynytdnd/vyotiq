/**
 * Reasoning row collapse + auto-close regressions.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

describe('reasoning — auto-close stale streams', () => {
  it('closes prior open reasoning when a new assistant id starts thinking', () => {
    const events: TimelineEvent[] = [
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 1000, delta: 'plan A' },
      { kind: 'agent-reasoning-delta', id: 'r2', ts: 2000, delta: 'plan B' }
    ];
    const after = rebuildTimelineState(events);
    expect(after.reasoningTexts['r1']).toMatchObject({ done: true, endedAt: 2000 });
    expect(after.reasoningTexts['r2']).toMatchObject({ done: false, text: 'plan B' });
  });

  it('closes open reasoning when tool-call-args-delta lands without reasoning-end', () => {
    let state = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-reasoning-delta',
      id: 'r1',
      ts: 1000,
      delta: 'still thinking'
    });
    state = applyTimelineEvent(state, {
      kind: 'tool-call-args-delta',
      callId: 'call-1',
      index: 0,
      argsBuf: '{"path":',
      ts: 1500
    });
    expect(state.reasoningTexts['r1']).toMatchObject({ done: true, endedAt: 1500 });
  });

  it('closes open reasoning when authoritative tool-call lands', () => {
    let state = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-reasoning-delta',
      id: 'r1',
      ts: 1000,
      delta: 'thinking'
    });
    state = applyTimelineEvent(state, {
      kind: 'tool-call',
      ts: 1800,
      call: { id: 'c1', name: 'read', arguments: { path: 'a.ts' } }
    });
    expect(state.reasoningTexts['r1']).toMatchObject({ done: true, endedAt: 1800 });
  });
});

describe('deriveRows — reasoning persistence', () => {
  it('keeps every completed reasoning-line row within a user turn', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 0, text: 'go' },
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 100, delta: 'a' },
      { kind: 'agent-reasoning-end', id: 'r1', ts: 200 },
      { kind: 'tool-call', ts: 300, call: { id: 'c1', name: 'read', arguments: {} } },
      { kind: 'tool-result', ts: 400, result: { id: 'c1', name: 'read', ok: true, output: 'ok' } },
      { kind: 'agent-reasoning-delta', id: 'r2', ts: 500, delta: 'b' },
      { kind: 'agent-reasoning-end', id: 'r2', ts: 600 }
    ];
    const rows = deriveRows(events);
    const reasoning = rows.filter((r) => r.kind === 'reasoning-line');
    expect(reasoning).toHaveLength(2);
    expect(reasoning.map((r) => (r.kind === 'reasoning-line' ? r.id : ''))).toEqual(['r1', 'r2']);
  });
});

describe('reasoning — reopen after auto-close', () => {
  it('resets done when more deltas arrive for the same id after auto-close', () => {
    let state = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-reasoning-delta',
      id: 'r1',
      ts: 1000,
      delta: 'plan'
    });
    state = applyTimelineEvent(state, {
      kind: 'tool-call',
      ts: 1500,
      call: { id: 'c1', name: 'read', arguments: { path: 'a.ts' } }
    });
    expect(state.reasoningTexts['r1']).toMatchObject({ done: true });

    state = applyTimelineEvent(state, {
      kind: 'agent-reasoning-delta',
      id: 'r1',
      ts: 2000,
      delta: ' more'
    });
    expect(state.reasoningTexts['r1']).toMatchObject({
      done: false,
      text: 'plan more',
      startedAt: 2000
    });
    expect(state.reasoningTexts['r1']?.endedAt).toBeUndefined();
  });
});
