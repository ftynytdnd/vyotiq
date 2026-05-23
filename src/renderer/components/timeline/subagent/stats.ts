import type { SubAgentSnapshot } from '../reducer/types.js';

interface SubAgentAggregateStats {
  running: number;
  done: number;
  failed: number;
  total: number;
}

function aggregateSubAgentStats(
  workers: readonly SubAgentSnapshot[],
  batchSinceTs?: number
): SubAgentAggregateStats {
  let running = 0;
  let done = 0;
  let failed = 0;
  let total = 0;
  for (const w of workers) {
    if (batchSinceTs !== undefined && w.startedAt < batchSinceTs) continue;
    total++;
    if (w.status === 'pending' || w.status === 'running') running++;
    else if (w.status === 'done' || w.status === 'partial') done++;
    else failed++;
  }
  return { running, done, failed, total };
}

export function aggregateSubAgentStatsSplit(
  workers: readonly SubAgentSnapshot[],
  batchSinceTs?: number
): { batch: SubAgentAggregateStats; earlier: SubAgentAggregateStats } {
  if (batchSinceTs === undefined) {
    const all = aggregateSubAgentStats(workers);
    return {
      batch: all,
      earlier: { running: 0, done: 0, failed: 0, total: 0 }
    };
  }
  const batchWorkers = workers.filter((w) => w.startedAt >= batchSinceTs);
  const earlierWorkers = workers.filter((w) => w.startedAt < batchSinceTs);
  return {
    batch: aggregateSubAgentStats(batchWorkers),
    earlier: aggregateSubAgentStats(earlierWorkers)
  };
}
