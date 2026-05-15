/**
 * Regression tests for `useChatStore.errorRun` — the action wired to
 * the `chat:error` IPC channel.
 *
 * Audit fix F-024: pre-fix, this action APPENDED a synthetic
 * `kind: 'error'` timeline event from the IPC payload. But the matching
 * error event has ALREADY been streamed via `chat:event` (every
 * `deps.onError(...)` call in `AgentV.ts` / `runLoop.ts` is preceded by
 * an `emit({ kind: 'error', ... })`). The result was a duplicate row
 * for every run-level failure — same message, two stacked cards.
 *
 * Post-fix, `errorRun` is purely a "clear run-state slots" action: it
 * flips `isProcessing` off, releases the `runId` mapping, and trusts
 * the event stream to have delivered the visible error row. This file
 * pins both halves of the contract:
 *
 *   1. The pre-existing error event (delivered via `chat:event`)
 *      remains the only error row visible.
 *   2. Run-state slots (`runId`, `isProcessing`, `runStartedAt`,
 *      `latestOrchestratorRunStatus`) are cleared.
 *
 * If a future refactor restores the appendmany-error path, test (1)
 * fails and the duplicate-row regression is caught.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

const CONV_ID = 'cA';
const RUN_ID = 'r1';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    slices: {},
    runIdToConv: {},
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

/**
 * Seed a slice that mirrors what the renderer would look like after
 * `chat:event` delivered the run-level error event (via the `emit()`
 * path in `AgentV.ts`'s catch block) but BEFORE `chat:error` calls
 * `errorRun`. This is the exact mid-flight state where the duplicate-
 * row bug used to surface.
 */
function seedSliceWithStreamedError(message: string): TimelineEvent {
  const errEvent: TimelineEvent = {
    kind: 'error',
    id: 'evt-err-1',
    ts: 1_000,
    message
  };
  useChatStore.setState({
    slices: {
      [CONV_ID]: {
        ...INITIAL_TIMELINE_STATE,
        conversationId: CONV_ID,
        events: [errEvent],
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {},
        runId: RUN_ID,
        isProcessing: true,
        runStartedAt: 100,
        draft: ''
      }
    },
    runIdToConv: { [RUN_ID]: CONV_ID },
    conversationId: CONV_ID,
    events: [errEvent],
    runId: RUN_ID,
    isProcessing: true,
    runStartedAt: 100
  });
  return errEvent;
}

describe('useChatStore.errorRun (audit fix F-024)', () => {
  it('does NOT append a duplicate error event for the IPC `message`', () => {
    seedSliceWithStreamedError('Provider failed 3 times in a row: oops');

    useChatStore
      .getState()
      .errorRun(RUN_ID, 'Provider failed 3 times in a row: oops');

    const slice = useChatStore.getState().slices[CONV_ID]!;
    // The slice still has exactly the ONE error event the streamed
    // `chat:event` delivered. Pre-fix, this list grew to length 2.
    expect(slice.events.filter((e) => e.kind === 'error')).toHaveLength(1);
    expect(slice.events).toHaveLength(1);
  });

  it('clears run-state slots and the runId mapping', () => {
    seedSliceWithStreamedError('boom');

    useChatStore.getState().errorRun(RUN_ID, 'boom');

    const s = useChatStore.getState();
    expect(s.runIdToConv[RUN_ID]).toBeUndefined();
    const slice = s.slices[CONV_ID]!;
    expect(slice.isProcessing).toBe(false);
    expect(slice.runId).toBeNull();
    expect(slice.runStartedAt).toBeNull();
    expect(slice.latestOrchestratorRunStatus).toBeUndefined();
    // Active mirror reflects the cleared slice (it WAS the active
    // conversation when the error landed).
    expect(s.runId).toBeNull();
    expect(s.isProcessing).toBe(false);
  });

  it('is a no-op when the runId is unknown (already-cleared late ack)', () => {
    // No seeded slice. A late `chat:error` that arrives after a
    // successful `finishRun` has already cleared the mapping must
    // not crash and must not synthesize a new slice.
    useChatStore.getState().errorRun('phantom-run', 'late ack');
    const s = useChatStore.getState();
    expect(Object.keys(s.slices)).toHaveLength(0);
    expect(Object.keys(s.runIdToConv)).toHaveLength(0);
  });

  it('does not touch a slice whose runId no longer matches', () => {
    // Mid-flight: a NEW run started on the same conversation between
    // the streamed error and the `chat:error` ack. The mapping has
    // been swapped to the new run; the late ack for the old run must
    // not clobber the new run's `isProcessing` slot.
    seedSliceWithStreamedError('old run died');
    useChatStore.setState((s) => ({
      ...s,
      slices: {
        ...s.slices,
        [CONV_ID]: {
          ...s.slices[CONV_ID]!,
          runId: 'r2',
          isProcessing: true,
          runStartedAt: 200
        }
      },
      runIdToConv: { [RUN_ID]: CONV_ID, r2: CONV_ID },
      runId: 'r2'
    }));

    useChatStore.getState().errorRun(RUN_ID, 'old run died');

    const slice = useChatStore.getState().slices[CONV_ID]!;
    // The new run is untouched.
    expect(slice.runId).toBe('r2');
    expect(slice.isProcessing).toBe(true);
    expect(slice.runStartedAt).toBe(200);
    // Old runId mapping is gone (errorRun always clears its own).
    expect(useChatStore.getState().runIdToConv[RUN_ID]).toBeUndefined();
  });
});
