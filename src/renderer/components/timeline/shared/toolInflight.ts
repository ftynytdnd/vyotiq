/**
 * In-flight detection helpers for timeline tool groups.
 *
 * `toolGroupLiveAutoExpand` drives the `liveAutoExpand` prop on
 * `useTimelineRowExpand` — a typed contract point for per-tool-type
 * auto-expand decisions.
 */

import type { ToolName } from '@shared/types/tool.js';
import { tailInFlightEditChildIndex, type ToolGroupChild } from '../reducer/deriveRows.js';

/**
 * Whether a tool-group row should auto-expand while in flight.
 *
 * `edit` groups auto-expand while the tail child is streaming so the
 * user sees live hunks without clicking. Other tool types stay
 * collapsed (one-line summary) unless expanded manually.
 */
export function toolGroupLiveAutoExpand(
  toolName: ToolName,
  items: ToolGroupChild[]
): boolean {
  if (toolName !== 'edit') return false;
  const idx = tailInFlightEditChildIndex(items);
  if (idx === null) return false;
  const child = items[idx];
  if (!child || child.result) return false;
  return child.partial === true || child.diffStream != null || child.call != null;
}
