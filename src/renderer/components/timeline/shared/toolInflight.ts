/**
 * In-flight detection helpers for timeline tool groups.
 *
 * `toolGroupLiveAutoExpand` drives the `liveAutoExpand` prop on
 * `useTimelineRowExpand` — a typed contract point for per-tool-type
 * auto-expand decisions. Currently returns `false` for all tools
 * (collapsed one-line UX); see the function's own JSDoc for rationale.
 */

import type { ToolName } from '@shared/types/tool.js';
import type { ToolGroupChild } from '../reducer/deriveRows.js';

/**
 * Whether a tool-group row should auto-expand while in flight.
 *
 * Returns `false` for all tool types today — tool groups render as a
 * collapsed one-line summary during streaming and expand on a single
 * user click. This is the "collapsed one-line" UX: the summary row
 * shows verb + path + live `+N -M` stats, and one click opens both
 * the group AND the inner invocation shell simultaneously (eliminating
 * the pre-fix "two clicks to see a streaming diff" friction).
 *
 * The function exists as a typed contract point: if a future iteration
 * wants to auto-expand specific tool types (e.g. `bash` for live
 * terminal output), the change is isolated here and regression tests
 * in `liveDiffAutoExpand.test.tsx` catch any side effects.
 */
export function toolGroupLiveAutoExpand(
  _toolName: ToolName,
  _items: ToolGroupChild[]
): boolean {
  return false;
}
