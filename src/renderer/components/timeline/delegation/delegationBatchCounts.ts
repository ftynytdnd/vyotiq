import type { SubAgentSnapshot } from '../reducer/types.js';

export interface DelegationBatchCounts {
  total: number;
  running: number;
  queued: number;
  done: number;
}

export function countDelegationBatch(
  subagentIds: readonly string[],
  subagents: Readonly<Record<string, SubAgentSnapshot>>
): DelegationBatchCounts {
  let running = 0;
  let queued = 0;
  let done = 0;
  for (const id of subagentIds) {
    const status = subagents[id]?.status;
    if (status === 'queued') queued += 1;
    else if (status === 'pending' || status === 'running') running += 1;
    else if (status) done += 1;
  }
  return { total: subagentIds.length, running, queued, done };
}

/** e.g. "4 workers · 2 running · 2 queued" */
export function formatDelegationBatchLabel(counts: DelegationBatchCounts): string {
  const { total, running, queued, done } = counts;
  if (total <= 0) return '';
  const parts: string[] = [
    `${total} worker${total === 1 ? '' : 's'}`
  ];
  if (running > 0) parts.push(`${running} running`);
  if (queued > 0) parts.push(`${queued} queued`);
  if (done > 0 && running === 0 && queued === 0) {
    parts.push(`${done} done`);
  }
  return parts.join(' · ');
}
