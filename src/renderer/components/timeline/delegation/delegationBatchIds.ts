import type { SubAgentSnapshot } from '../reducer/types.js';

/** Unique sub-agent ids for one delegation round (stable by start time). */
export function subagentIdsForDelegationBatch(
  batchId: string,
  subagents: Readonly<Record<string, SubAgentSnapshot>>
): string[] {
  const matches: SubAgentSnapshot[] = [];
  for (const snap of Object.values(subagents)) {
    if (snap.delegationBatchId === batchId) matches.push(snap);
  }
  matches.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  return matches.map((s) => s.id);
}

export function delegationBatchRowKey(batchId: string): string {
  return `delegation-batch:${batchId}`;
}

export function isDelegationBatchSettled(
  subagentIds: readonly string[],
  subagents: Readonly<Record<string, SubAgentSnapshot>>
): boolean {
  if (subagentIds.length === 0) return false;
  return subagentIds.every((id) => {
    const st = subagents[id]?.status;
    return (
      st === 'done' ||
      st === 'partial' ||
      st === 'failed' ||
      st === 'malformed' ||
      st === 'aborted'
    );
  });
}

/** Per-worker cards: never while queued; settled only when the batch is expanded. */
export function isWorkerCardVisible(
  subagents: Readonly<Record<string, SubAgentSnapshot>>,
  subagentId: string,
  batchExpanded: boolean
): boolean {
  const st = subagents[subagentId]?.status;
  if (!st || st === 'queued') return false;
  if (st === 'pending' || st === 'running') return true;
  return batchExpanded;
}

export function delegationBatchHasLiveWorkers(
  subagentIds: readonly string[],
  subagents: Readonly<Record<string, SubAgentSnapshot>>
): boolean {
  return subagentIds.some((id) => {
    const status = subagents[id]?.status;
    return status === 'pending' || status === 'running' || status === 'queued';
  });
}
