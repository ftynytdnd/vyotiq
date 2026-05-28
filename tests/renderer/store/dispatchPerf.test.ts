/**
 * Dispatch fan-out smoke test for `useChatStore.applyEvent`.
 *
 * The multi-session refactor introduces an extra `runIdToConv`
 * indirection on every event. This test pins the cost: 5,000 events
 * fanned across 50 slices must complete well under a generous wall-
 * clock budget. Pre-fix profiling showed ~12ms; this guards against a
 * regression that would (e.g.) re-spread `s.slices` on every miss
 * for an inactive slice or accidentally make the per-event work O(N)
 * in the slice count.
 *
 * The threshold is intentionally loose (500ms on a slow or contested
 * CI worker) because the goal is "no quadratic-ish surprise", not
 * micro-bench stability. Vitest reporters tag this as a perf check via
 * the test name so CI can grep for it if a worker is heavily contested.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture, type ChatSliceFixture } from '../../_fixtures/chatSlice';

const SLICE_COUNT = 50;
const EVENTS_PER_SLICE = 100;
const TOTAL_EVENTS = SLICE_COUNT * EVENTS_PER_SLICE;
const BUDGET_MS = 500;

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('useChatStore.applyEvent — dispatch perf smoke', () => {
  it(`dispatches ${TOTAL_EVENTS} events across ${SLICE_COUNT} slices under ${BUDGET_MS}ms`, () => {
    // Seed slices + mapping. Active conversation is the FIRST slice so
    // exactly one slice's events trigger the mirror update path; the
    // other 49 stay on the cheap "just patch slices" path.
    const slices: Record<string, ChatSliceFixture> = {};
    const runIdToConv: Record<string, string> = {};
    for (let i = 0; i < SLICE_COUNT; i++) {
      const convId = `conv-${i}`;
      const runId = `run-${i}`;
      slices[convId] = chatSliceFixture({
        conversationId: convId,
        runId,
        isProcessing: true,
        runStartedAt: i
      });
      runIdToConv[runId] = convId;
    }
    useChatStore.setState({
      slices,
      runIdToConv,
      conversationId: 'conv-0',
      runId: 'run-0',
      isProcessing: true,
      runStartedAt: 0
    });

    const { applyEvent } = useChatStore.getState();

    const start = performance.now();
    for (let n = 0; n < EVENTS_PER_SLICE; n++) {
      for (let i = 0; i < SLICE_COUNT; i++) {
        applyEvent(`run-${i}`, {
          kind: 'agent-text-delta',
          id: `t-${i}`,
          ts: n,
          delta: 'x'
        });
      }
    }
    const elapsed = performance.now() - start;

    // Correctness: every slice received exactly EVENTS_PER_SLICE events
    // accumulated into its assistantTexts. We don't enumerate every
    // slice — the corruption case would show up in a length check on
    // a couple of representative ones plus the active mirror.
    const s = useChatStore.getState();
    expect(s.slices['conv-0']!.assistantTexts['t-0']!.text).toHaveLength(EVENTS_PER_SLICE);
    expect(s.slices[`conv-${SLICE_COUNT - 1}`]!.assistantTexts[`t-${SLICE_COUNT - 1}`]!.text).toHaveLength(
      EVENTS_PER_SLICE
    );
    // Active mirror reflects the active slice's accumulator.
    expect(s.assistantTexts['t-0']!.text).toHaveLength(EVENTS_PER_SLICE);

    // Perf: well under the loose budget. If this trips, profile
    // `applyEvent` for an O(N) regression in slice count.
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

