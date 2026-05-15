/**
 * Reasoning-stopwatch reducer regression. Plan §C.
 *
 * The reducer must:
 *   - stamp `startedAt` on the first `agent-reasoning-delta` for an id,
 *   - leave `startedAt` unchanged on subsequent deltas for the same id,
 *   - stamp `endedAt` AND set `done: true` on `agent-reasoning-end`.
 *
 * Without these timestamps the row renderer falls back to a fake
 * char-count derivation; we guard that here so future refactors can't
 * silently regress the live-stopwatch contract.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

describe('applyTimelineEvent — reasoning timestamps', () => {
  it('stamps startedAt on the first delta', () => {
    const evt: TimelineEvent = {
      kind: 'agent-reasoning-delta',
      id: 'r1',
      ts: 5000,
      delta: 'thinking…'
    };
    const next = applyTimelineEvent(INITIAL_TIMELINE_STATE, evt);
    expect(next.reasoningTexts['r1']).toMatchObject({
      id: 'r1',
      text: 'thinking…',
      done: false,
      startedAt: 5000
    });
    expect(next.reasoningTexts['r1']?.endedAt).toBeUndefined();
  });

  it('preserves startedAt across subsequent deltas (no regression on bursts)', () => {
    const events: TimelineEvent[] = [
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 5000, delta: 'a' },
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 5500, delta: 'b' },
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 6000, delta: 'c' }
    ];
    const after = rebuildTimelineState(events);
    expect(after.reasoningTexts['r1']?.startedAt).toBe(5000);
    expect(after.reasoningTexts['r1']?.text).toBe('abc');
  });

  it('stamps endedAt and flips done on agent-reasoning-end', () => {
    const events: TimelineEvent[] = [
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 5000, delta: 'a' },
      { kind: 'agent-reasoning-end', id: 'r1', ts: 7000 }
    ];
    const after = rebuildTimelineState(events);
    expect(after.reasoningTexts['r1']).toMatchObject({
      done: true,
      startedAt: 5000,
      endedAt: 7000
    });
  });

  it('agent-reasoning-end is a no-op when no matching delta exists', () => {
    const next = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-reasoning-end',
      id: 'r-orphan',
      ts: 7000
    });
    expect(next.reasoningTexts['r-orphan']).toBeUndefined();
  });

  it(
    'auto-closes reasoning the moment the first agent-text-delta lands ' +
    'for the same id, even when no agent-reasoning-end was emitted',
    () => {
      // Mirrors the "DeepSeek packs final reasoning_content + first
      // content into the same SSE chunk" case where the upstream
      // reasoning-end marker can be skipped. The reducer must
      // re-derive done-state from observable content-delta arrival
      // so the renderer's reasoning panel collapses immediately
      // instead of staying on "Thinking…" until the whole turn ends.
      const events: TimelineEvent[] = [
        { kind: 'agent-reasoning-delta', id: 'm1', ts: 1000, delta: 'planning…' },
        { kind: 'agent-reasoning-delta', id: 'm1', ts: 1500, delta: ' more thinking' },
        { kind: 'agent-text-delta', id: 'm1', ts: 2200, delta: 'Hello' }
      ];
      const after = rebuildTimelineState(events);
      expect(after.reasoningTexts['m1']).toMatchObject({
        done: true,
        startedAt: 1000,
        endedAt: 2200
      });
      expect(after.assistantTexts['m1']?.text).toBe('Hello');
    }
  );

  it(
    'preserves the original reasoning-end timestamp when text starts ' +
    'streaming AFTER an explicit agent-reasoning-end',
    () => {
      // The well-behaved provider path: explicit reasoning-end stamps
      // `endedAt = 7000`. Subsequent text deltas at `ts = 8000` must
      // NOT bump `endedAt` forward — that would inflate the
      // "Thought for Ns" label with the time spent streaming the
      // post-reasoning answer.
      const events: TimelineEvent[] = [
        { kind: 'agent-reasoning-delta', id: 'm2', ts: 5000, delta: 'a' },
        { kind: 'agent-reasoning-end', id: 'm2', ts: 7000 },
        { kind: 'agent-text-delta', id: 'm2', ts: 8000, delta: 'reply' }
      ];
      const after = rebuildTimelineState(events);
      expect(after.reasoningTexts['m2']).toMatchObject({
        done: true,
        startedAt: 5000,
        endedAt: 7000
      });
    }
  );
});
