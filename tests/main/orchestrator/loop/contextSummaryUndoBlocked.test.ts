import { describe, expect, it } from 'vitest';
import { isContextSummaryUndoBlocked } from '@main/orchestrator/loop/runLoop';

describe('isContextSummaryUndoBlocked', () => {
  const idle = {
    iterationInFlight: false,
    summarizationStarting: false,
    activeSummaryId: undefined as string | undefined
  };

  it('blocks undo during an active iteration', () => {
    expect(
      isContextSummaryUndoBlocked({ ...idle, iterationInFlight: true })
    ).toBe(true);
  });

  it('blocks undo while summarization is starting or in flight', () => {
    expect(
      isContextSummaryUndoBlocked({ ...idle, summarizationStarting: true })
    ).toBe(true);
    expect(
      isContextSummaryUndoBlocked({ ...idle, activeSummaryId: 'sum-1' })
    ).toBe(true);
  });

  it('allows undo at iteration boundary with no active summary', () => {
    expect(isContextSummaryUndoBlocked(idle)).toBe(false);
  });
});
