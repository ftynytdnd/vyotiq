/**
 * Transcript repair for sub-agents left non-terminal after a hard kill
 * or aborted delegation (spawn/status without a terminal `subagent-status`).
 *
 * When `closeWhenIdle` is true, appends synthetic `subagent-status` events
 * with `status: 'aborted'` for every spawned id that never received a
 * terminal status. Callers gate on "no active run for this conversation"
 * (main `listActiveRuns`, renderer slice `isProcessing` / `runId`).
 */

import type { TimelineEvent } from '../types/chat.js';

const TERMINAL_SUBAGENT_STATUSES = new Set<
  Extract<TimelineEvent, { kind: 'subagent-status' }>['status']
>(['done', 'partial', 'failed', 'malformed', 'aborted']);

export type RepairNonTerminalSubagentsOptions = {
  /** When false, returns the input unchanged (steady-state fast path). */
  closeWhenIdle: boolean;
};

/**
 * Collect sub-agent ids that have a `subagent-spawn` in flight without a
 * later terminal `subagent-status`. Re-spawn after terminal clears the id
 * until the next terminal status lands.
 */
export function nonTerminalSpawnedSubagentIds(events: TimelineEvent[]): string[] {
  const open = new Set<string>();
  for (const e of events) {
    if (e.kind === 'subagent-spawn') open.add(e.subagentId);
    else if (
      e.kind === 'subagent-status' &&
      TERMINAL_SUBAGENT_STATUSES.has(e.status)
    ) {
      open.delete(e.subagentId);
    }
  }
  return [...open];
}

/**
 * Append synthetic `subagent-status` / `aborted` rows for open spawns.
 * Preserves input reference when nothing to repair.
 */
export function repairNonTerminalSubagents(
  events: TimelineEvent[],
  opts: RepairNonTerminalSubagentsOptions
): TimelineEvent[] {
  if (!opts.closeWhenIdle) return events;
  const toClose = nonTerminalSpawnedSubagentIds(events);
  if (toClose.length === 0) return events;
  const lastTs = events.length > 0 ? events[events.length - 1]!.ts : 0;
  const synthetic: TimelineEvent[] = toClose.map((subagentId, i) => ({
    kind: 'subagent-status',
    id: `repair-aborted-${subagentId}`,
    ts: lastTs + i + 1,
    subagentId,
    status: 'aborted',
    message: '(closed on transcript load — no active run)'
  }));
  return [...events, ...synthetic];
}
