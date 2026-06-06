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
  const partialToolCallArgs = state.partialToolCallArgs ?? {};
  const liveDiffByCallId = state.liveDiffByCallId ?? {};
  const settledCallIds = state.settledCallIds ?? {};
  const toolResultSettledIds = state.toolResultSettledIds ?? {};
  if (
    Object.keys(partialToolCallArgs).length === 0 &&
    Object.keys(liveDiffByCallId).length === 0 &&
    Object.keys(settledCallIds).length === 0 &&
    Object.keys(toolResultSettledIds).length === 0
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
