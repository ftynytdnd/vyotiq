/**
 * Timeline reducer: `token-usage` event handling.
 *
 * Verifies that:
 *   - `token-usage` folds into `TimelineState.orchestratorUsage`.
 *   - `latest / peak / cumulative` are computed correctly across
 *     multiple reports.
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  foldTokenUsage,
  stampUsageStart,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function usageEvent(
  overrides: Partial<Extract<TimelineEvent, { kind: 'token-usage' }>>
): Extract<TimelineEvent, { kind: 'token-usage' }> {
  return {
    kind: 'token-usage',
    id: 'e1',
    ts: 1,
    assistantMsgId: 'm1',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    ...overrides
  };
}

describe('foldTokenUsage', () => {
  it('seeds latest/peak/cumulative on the first sample', () => {
    const agg = foldTokenUsage(undefined, {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120
    });
    expect(agg.samples).toBe(1);
    expect(agg.latest).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    expect(agg.peak).toEqual(agg.latest);
    expect(agg.cumulative).toEqual(agg.latest);
  });

  it('tracks peak independently per field', () => {
    let agg = foldTokenUsage(undefined, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    agg = foldTokenUsage(agg, { promptTokens: 80, completionTokens: 200, totalTokens: 280 });
    expect(agg.peak).toEqual({ promptTokens: 100, completionTokens: 200, totalTokens: 280 });
  });

  it('accumulates cumulative totals', () => {
    let agg = foldTokenUsage(undefined, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    agg = foldTokenUsage(agg, { promptTokens: 50, completionTokens: 10, totalTokens: 60 });
    expect(agg.cumulative).toEqual({ promptTokens: 150, completionTokens: 30, totalTokens: 180 });
    expect(agg.samples).toBe(2);
  });

  it('always updates latest to the most recent sample', () => {
    let agg = foldTokenUsage(undefined, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    agg = foldTokenUsage(agg, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    expect(agg.latest).toEqual({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  });
});

describe('applyTimelineEvent: token-usage', () => {
  it('routes token-usage into orchestratorUsage', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, usageEvent({}));
    expect(s.orchestratorUsage?.latest.promptTokens).toBe(100);
  });

  it('folds multiple usage reports into latest/peak/cumulative on orchestratorUsage', () => {
    let s: TimelineState = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'e1',
        assistantMsgId: 'm1',
        usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 }
      })
    );
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'e2',
        assistantMsgId: 'm1',
        usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 }
      })
    );
    const u = s.orchestratorUsage;
    expect(u?.latest).toEqual({ promptTokens: 500, completionTokens: 200, totalTokens: 700 });
    expect(u?.peak).toEqual({ promptTokens: 1000, completionTokens: 200, totalTokens: 1050 });
    expect(u?.cumulative).toEqual({
      promptTokens: 1500,
      completionTokens: 250,
      totalTokens: 1750
    });
    expect(u?.samples).toBe(2);
  });

  it('appends token-usage events into the events array so transcripts persist them', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, usageEvent({}));
    expect(s.events.some((e) => e.kind === 'token-usage')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 12 (2026) — tok/s anchors (`streamStartedAt`, `streamEndedAt`)
// ────────────────────────────────────────────────────────────────────

describe('stampUsageStart', () => {
  it('creates a zero-valued aggregate with streamStartedAt when prior is undefined', () => {
    const out = stampUsageStart(undefined, 1234);
    expect(out.streamStartedAt).toBe(1234);
    expect(out.samples).toBe(0);
    expect(out.latest).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('is idempotent — subsequent calls preserve object identity', () => {
    // Object identity matters here: the renderer relies on
    // `orchestratorUsage !== state.orchestratorUsage` to decide
    // whether to dispatch a state update. Re-stamping on every
    // delta would churn React selectors needlessly.
    const first = stampUsageStart(undefined, 1234);
    const second = stampUsageStart(first, 9999);
    expect(second).toBe(first);
    expect(second.streamStartedAt).toBe(1234);
  });

  it('preserves existing latest/peak/cumulative on an established aggregate', () => {
    const seeded = foldTokenUsage(undefined, {
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125
    });
    const stamped = stampUsageStart(seeded, 5000);
    expect(stamped.streamStartedAt).toBe(5000);
    expect(stamped.latest.promptTokens).toBe(100);
    expect(stamped.samples).toBe(1);
  });
});

describe('foldTokenUsage — timestamp plumbing', () => {
  it('records streamEndedAt on the first fold', () => {
    const agg = foldTokenUsage(
      undefined,
      { promptTokens: 100, completionTokens: 25, totalTokens: 125 },
      9_999
    );
    expect(agg.streamEndedAt).toBe(9_999);
    // streamStartedAt is untouched — that's the `stampUsageStart`
    // contract, not the fold's.
    expect(agg.streamStartedAt).toBeUndefined();
  });

  it('advances streamEndedAt on each subsequent fold while preserving streamStartedAt', () => {
    let agg = stampUsageStart(undefined, 1_000);
    agg = foldTokenUsage(
      agg,
      { promptTokens: 100, completionTokens: 25, totalTokens: 125 },
      3_500
    );
    agg = foldTokenUsage(
      agg,
      { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
      7_500
    );
    expect(agg.streamStartedAt).toBe(1_000);
    expect(agg.streamEndedAt).toBe(7_500);
  });

  it('leaves both timestamps untouched when `ts` is omitted', () => {
    // Legacy callers (the reducer's `rebuildTimelineState` batch
    // replay path passes events through `applyTimelineEvent`,
    // which DOES forward `ts`, so the omission path is rare).
    const seeded = stampUsageStart(undefined, 1_000);
    const out = foldTokenUsage(seeded, {
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125
    });
    expect(out.streamStartedAt).toBe(1_000);
    expect(out.streamEndedAt).toBeUndefined();
  });
});

describe('applyTimelineEvent — tok/s anchor plumbing', () => {
  it('stamps streamStartedAt on the first agent-text-delta for the orchestrator', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-text-delta',
      id: 'msg-1',
      ts: 2_500,
      delta: 'Hello'
    });
    expect(s.orchestratorUsage?.streamStartedAt).toBe(2_500);
  });

  it('does NOT advance streamStartedAt on subsequent deltas', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-text-delta',
      id: 'msg-1',
      ts: 2_500,
      delta: 'Hello'
    });
    s = applyTimelineEvent(s, {
      kind: 'agent-text-delta',
      id: 'msg-1',
      ts: 9_999,
      delta: ' world'
    });
    expect(s.orchestratorUsage?.streamStartedAt).toBe(2_500);
  });

  it('stamps streamStartedAt on the first agent-reasoning-delta for the orchestrator', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-reasoning-delta',
      id: 'msg-2',
      ts: 1_000,
      delta: 'thinking...'
    });
    expect(s.orchestratorUsage?.streamStartedAt).toBe(1_000);
  });

  it('forwards token-usage.ts as streamEndedAt on the orchestrator aggregate', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'agent-text-delta',
      id: 'msg-1',
      ts: 1_000,
      delta: 'Hi'
    });
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'u1',
        ts: 3_500,
        usage: { promptTokens: 100, completionTokens: 25, totalTokens: 125 }
      })
    );
    expect(s.orchestratorUsage?.streamStartedAt).toBe(1_000);
    expect(s.orchestratorUsage?.streamEndedAt).toBe(3_500);
  });

  it('stamps stream anchors on orchestratorUsage for agent text deltas', () => {
    let s: TimelineState = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(s, {
      kind: 'agent-text-delta',
      id: 'iter-1',
      ts: 1_000,
      delta: 'starting'
    });
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'u-sa',
        ts: 5_000,
        assistantMsgId: 'iter-1',
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 }
      })
    );
    const u = s.orchestratorUsage;
    expect(u?.streamStartedAt).toBe(1_000);
    expect(u?.streamEndedAt).toBe(5_000);
    expect(s.assistantTexts['iter-1']?.text).toBe('starting');
  });
});
