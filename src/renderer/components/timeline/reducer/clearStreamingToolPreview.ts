/**
 * Clears in-flight tool preview state (partial args + live diffs).
 * Prevents stale synthesized rows (e.g. "Deleted …") from bleeding into
 * the next user turn when the prior run ended without `agent-text-aborted`.
 */

import type { TimelineState } from './types.js';

type StreamingPreviewSlice = Pick<
  TimelineState,
  'partialToolCallArgs' | 'liveDiffByCallId' | 'settledCallIds' | 'toolResultSettledIds'
>;

export function clearStreamingToolPreview<T extends StreamingPreviewSlice>(state: T): T {
  if (
    Object.keys(state.partialToolCallArgs).length === 0 &&
    Object.keys(state.liveDiffByCallId).length === 0 &&
    Object.keys(state.settledCallIds).length === 0 &&
    Object.keys(state.toolResultSettledIds).length === 0
  ) {
    return state;
  }
  return {
    ...state,
    partialToolCallArgs: {},
    liveDiffByCallId: {},
    settledCallIds: {},
    toolResultSettledIds: {}
  };
}
