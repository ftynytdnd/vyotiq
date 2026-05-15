/**
 * Timeline reducer: `history-summary` event handling.
 *
 * The `'history-summary'` kind (Audit fix §2.2) is a persistent
 * sentinel emitted when the orchestrator's summarizer compacts the
 * oldest half of a long session. Per the contract in
 * `@shared/types/chat.ts`, the LIVE renderer treats it as event-list-
 * only churn: append to `state.events` (so transcript reload's
 * `replacedEventIds` masking is a no-op for the live session), but
 * produce no UI row and never split the currently-open tool group.
 *
 * These tests pin both halves of that contract:
 *
 *   1. `applyTimelineEvent` appends the event without mutating any
 *      other slice of `TimelineState` (no subagent map churn, no
 *      usage churn, no run-status churn).
 *
 *   2. `deriveRows` does NOT emit a row for the event AND does NOT
 *      close a currently-open consecutive tool group around it —
 *      mirroring the same skip applied to `token-usage` /
 *      `run-status`.
 *
 * Without these tests, a future maintainer adding a UI surface for
 * summarization could quietly violate the contract (e.g. by emitting
 * a "compacted N turns" row) and the regression would only surface
 * as visual noise in long sessions, not as a test failure.
 */

import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import {
  INITIAL_TIMELINE_STATE,
  type TimelineState
} from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function summaryEvent(overrides: Partial<Extract<TimelineEvent, { kind: 'history-summary' }>> = {}):
  Extract<TimelineEvent, { kind: 'history-summary' }> {
  return {
    kind: 'history-summary',
    id: 's1',
    ts: 100,
    summary: 'Earlier turns covered: workspace bootstrap, two failed bash attempts, ...',
    replacedEventIds: ['ev-1', 'ev-2', 'ev-3'],
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    ...overrides
  };
}

describe('applyTimelineEvent — history-summary (audit §2.2)', () => {
  it('appends the event to state.events without producing a UI row', () => {
    const seed: TimelineState = { ...INITIAL_TIMELINE_STATE, events: [] };
    const next = applyTimelineEvent(seed, summaryEvent());

    expect(next.events).toHaveLength(1);
    expect(next.events[0]?.kind).toBe('history-summary');

    // Importantly, deriveRows() must NOT emit a row for this event.
    const rows = deriveRows(next.events, { runActive: false });
    expect(rows).toHaveLength(0);
  });

  it('does not mutate other slices of TimelineState (subagents / usage / run-status)', () => {
    // Seed a state where every other slice is non-default so we can
    // assert reference-equality after the reducer step.
    const seed: TimelineState = {
      ...INITIAL_TIMELINE_STATE,
      events: [],
      subagents: { S1: { id: 'S1', task: 't', status: 'running' } as never },
      orchestratorUsage: { samples: 1, latest: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, peak: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, cumulative: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } } as never,
      latestOrchestratorRunStatus: { kind: 'run-status', id: 'r1', ts: 99 } as never
    };
    const next = applyTimelineEvent(seed, summaryEvent());

    // Reference-equality on the unchanged slices proves the reducer
    // did not inadvertently rebuild them.
    expect(next.subagents).toBe(seed.subagents);
    expect(next.orchestratorUsage).toBe(seed.orchestratorUsage);
    expect(next.latestOrchestratorRunStatus).toBe(seed.latestOrchestratorRunStatus);
  });

  it('does NOT split a consecutive tool-group when it lands between two same-tool calls', () => {
    // Mirror the same property `token-usage` and `run-status` enjoy:
    // a history-summary landing between two `tool-call`s of the same
    // name must not produce two separate group headers in the row
    // stream — the rolled-up group has to span across the sentinel.
    const baseToolCall = (id: string): TimelineEvent => ({
      kind: 'tool-call',
      id,
      ts: 1,
      call: { id, name: 'read', args: {} }
    } as TimelineEvent);

    const events: TimelineEvent[] = [
      baseToolCall('c1'),
      summaryEvent({ id: 's-mid', ts: 2 }),
      baseToolCall('c2')
    ];

    const rows = deriveRows(events, { runActive: false });
    // Group rows are emitted under `kind: 'tool-group'`. There must
    // be exactly ONE such group — not two.
    const groupRows = rows.filter((r) => r.kind === 'tool-group');
    expect(groupRows).toHaveLength(1);
  });
});
