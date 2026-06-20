/**
 * On transcript load, normalize timelines recorded before the solo-agent model.
 * - Drops legacy worker lifecycle rows (pending/spawn/status/result).
 * - Drops legacy phased-execution rows (phase / phase-gate / phase-ledger-entry).
 * - Strips legacy `subagentId` / `subagentTurnId` fields from surviving events.
 */

import type { TimelineEvent } from '../types/chat.js';

const LEGACY_WORKER_LIFECYCLE_KINDS = new Set<string>([
  'subagent-pending',
  'subagent-spawn',
  'subagent-status',
  'subagent-result'
]);

const LEGACY_PHASE_KINDS = new Set<string>([
  'phase',
  'phase-gate',
  'phase-ledger-entry'
]);

function stripLegacyWorkerIds<T extends TimelineEvent>(e: T): T {
  if (!('subagentId' in e) || e.subagentId === undefined) return e;
  const { subagentId: _removed, subagentTurnId: _turn, ...rest } = e as T & {
    subagentId?: string;
    subagentTurnId?: string;
  };
  return rest as T;
}

export function normalizeLegacyTranscript(events: TimelineEvent[]): TimelineEvent[] {
  let changed = false;
  const out: TimelineEvent[] = [];
  for (const e of events) {
    const kind = (e as { kind: string }).kind;
    if (LEGACY_WORKER_LIFECYCLE_KINDS.has(kind) || LEGACY_PHASE_KINDS.has(kind)) {
      changed = true;
      continue;
    }
    const stripped = stripLegacyWorkerIds(e);
    if (stripped !== e) changed = true;
    out.push(stripped);
  }
  return changed ? out : events;
}
