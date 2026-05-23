/**
 * Timeline reducer: `synthetic-usage-update` event handling (Phase 3
 * — 2026).
 *
 * The renderer's chat channel (Phase 3 wiring) dispatches synthetic
 * usage events as streaming text/reasoning deltas arrive so the
 * composer pill can grow during long generations. The reducer:
 *
 *   - Sets `TokenUsageAggregate.inFlight` to the synthetic
 *     completion-token estimate.
 *   - Does NOT touch `latest`, `peak`, `cumulative` (those stay
 *     authoritative; the synthetic counter is purely additive UI).
 *   - Routes to the orchestrator or the matching sub-agent based on
 *     `subagentId`, mirroring `token-usage`'s routing.
 *
 * The authoritative `token-usage` event clears `inFlight` via
 * `foldTokenUsage`'s contract — verified in the second-to-last test.
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  setInFlightUsage,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function synthEvent(
  overrides: Partial<Extract<TimelineEvent, { kind: 'synthetic-usage-update' }>>
): Extract<TimelineEvent, { kind: 'synthetic-usage-update' }> {
  return {
    kind: 'synthetic-usage-update',
    id: 'syn-1',
    ts: 1,
    completionTokens: 50,
    ...overrides
  };
}

describe('setInFlightUsage helper', () => {
  it('seeds a zero baseline + inFlight when prior is undefined', () => {
    const agg = setInFlightUsage(undefined, {
      promptTokens: 0,
      completionTokens: 50,
      totalTokens: 50
    });
    expect(agg.latest).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    expect(agg.inFlight).toEqual({ promptTokens: 0, completionTokens: 50, totalTokens: 50 });
    expect(agg.samples).toBe(0);
  });

  it('preserves the existing latest/peak/cumulative when prior is set', () => {
    const prior = {
      latest: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      peak: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      cumulative: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      samples: 1
    };
    const agg = setInFlightUsage(prior, {
      promptTokens: 0,
      completionTokens: 12,
      totalTokens: 12
    });
    expect(agg.latest).toEqual(prior.latest);
    expect(agg.peak).toEqual(prior.peak);
    expect(agg.cumulative).toEqual(prior.cumulative);
    expect(agg.inFlight?.completionTokens).toBe(12);
  });

  it('clears inFlight when next is undefined', () => {
    const prior = {
      latest: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      peak: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      cumulative: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
      samples: 1,
      inFlight: { promptTokens: 0, completionTokens: 99, totalTokens: 99 }
    };
    const agg = setInFlightUsage(prior, undefined);
    expect(agg.inFlight).toBeUndefined();
    expect(agg.latest).toEqual(prior.latest);
  });
});

describe('applyTimelineEvent: synthetic-usage-update', () => {
  it('routes orchestrator synthetic usage into orchestratorUsage.inFlight', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, synthEvent({}));
    expect(s.orchestratorUsage?.inFlight?.completionTokens).toBe(50);
    expect(s.orchestratorUsage?.latest).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    });
    expect(s.subagents).toEqual({});
  });

  it('does not append the event to state.events (pure live telemetry)', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, synthEvent({}));
    expect(s.events.some((e) => e.kind === 'synthetic-usage-update')).toBe(false);
  });

  it('routes sub-agent synthetic usage to the matching snapshot', () => {
    let s: TimelineState = INITIAL_TIMELINE_STATE;
    s = applyTimelineEvent(s, {
      kind: 'subagent-spawn',
      id: 'spawn',
      ts: 0,
      subagentId: 'sa-1',
      task: 't',
      files: [],
      tools: []
    });
    s = applyTimelineEvent(s, synthEvent({ subagentId: 'sa-1', completionTokens: 75 }));
    expect(s.subagents['sa-1']?.usage?.inFlight?.completionTokens).toBe(75);
    expect(s.orchestratorUsage).toBeUndefined();
  });

  it('drops sub-agent synthetic usage silently when no snapshot exists yet', () => {
    // Synthetic usage can race the sub-agent's spawn event on a fast
    // provider. The reducer must not synthesize a placeholder snapshot
    // for a sub-agent that the orchestrator never spawned — only the
    // authoritative `token-usage` path may do that.
    const s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      synthEvent({ subagentId: 'sa-orphan', completionTokens: 42 })
    );
    expect(s.subagents).toEqual({});
    expect(s.orchestratorUsage).toBeUndefined();
  });

  it('a later synthetic update REPLACES the prior inFlight (not adds)', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, synthEvent({ completionTokens: 50 }));
    s = applyTimelineEvent(s, synthEvent({ id: 'syn-2', completionTokens: 80 }));
    expect(s.orchestratorUsage?.inFlight?.completionTokens).toBe(80);
  });

  it('authoritative token-usage event clears inFlight while keeping latest', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, synthEvent({ completionTokens: 50 }));
    expect(s.orchestratorUsage?.inFlight?.completionTokens).toBe(50);
    s = applyTimelineEvent(s, {
      kind: 'token-usage',
      id: 'tu-1',
      ts: 2,
      assistantMsgId: 'm1',
      usage: { promptTokens: 1000, completionTokens: 60, totalTokens: 1060 }
    });
    expect(s.orchestratorUsage?.inFlight).toBeUndefined();
    expect(s.orchestratorUsage?.latest).toEqual({
      promptTokens: 1000,
      completionTokens: 60,
      totalTokens: 1060
    });
  });
});
