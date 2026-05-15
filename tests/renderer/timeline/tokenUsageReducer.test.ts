/**
 * Timeline reducer: `token-usage` event handling.
 *
 * Verifies that:
 *   - orchestrator usage (no subagentId) folds into
 *     `TimelineState.orchestratorUsage`.
 *   - sub-agent usage (with subagentId) folds into the matching
 *     `SubAgentSnapshot.usage` aggregate.
 *   - `latest / peak / cumulative` are computed correctly across
 *     multiple reports.
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import {
  INITIAL_TIMELINE_STATE,
  foldTokenUsage,
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
  it('routes orchestrator usage (no subagentId) into orchestratorUsage', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, usageEvent({}));
    expect(s.orchestratorUsage?.latest.promptTokens).toBe(100);
    expect(s.subagents).toEqual({});
  });

  it('routes sub-agent usage into the matching snapshot', () => {
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
    s = applyTimelineEvent(
      s,
      usageEvent({ id: 'e2', subagentId: 'sa-1', assistantMsgId: 'sa-1' })
    );
    expect(s.subagents['sa-1']?.usage?.latest.promptTokens).toBe(100);
    expect(s.orchestratorUsage).toBeUndefined();
  });

  it('folds multiple sub-agent reports into latest/peak/cumulative', () => {
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
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'e1',
        subagentId: 'sa-1',
        assistantMsgId: 'sa-1',
        usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 }
      })
    );
    s = applyTimelineEvent(
      s,
      usageEvent({
        id: 'e2',
        subagentId: 'sa-1',
        assistantMsgId: 'sa-1',
        usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 }
      })
    );
    const u = s.subagents['sa-1']?.usage;
    expect(u?.latest).toEqual({ promptTokens: 500, completionTokens: 200, totalTokens: 700 });
    expect(u?.peak).toEqual({ promptTokens: 1000, completionTokens: 200, totalTokens: 1050 });
    expect(u?.cumulative).toEqual({
      promptTokens: 1500,
      completionTokens: 250,
      totalTokens: 1750
    });
    expect(u?.samples).toBe(2);
  });

  it('creates a placeholder snapshot when usage arrives before the spawn event', () => {
    // Orderly delivery is not guaranteed — the reducer should tolerate
    // a usage report arriving before `subagent-spawn`.
    const s = applyTimelineEvent(
      INITIAL_TIMELINE_STATE,
      usageEvent({ subagentId: 'sa-2', assistantMsgId: 'sa-2' })
    );
    expect(s.subagents['sa-2']).toBeDefined();
    expect(s.subagents['sa-2']?.usage?.latest.promptTokens).toBe(100);
  });

  it('appends token-usage events into the events array so transcripts persist them', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, usageEvent({}));
    expect(s.events.some((e) => e.kind === 'token-usage')).toBe(true);
  });
});
