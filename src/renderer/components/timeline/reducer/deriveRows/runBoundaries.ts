import type { TokenUsageAggregate } from '../types.js';

export type OpenRun = {
  promptId: string;
  promptTs: number;
  lastTs: number;
  editCount: number;
  filePaths: Set<string>;
};
export type OpenRunUsage = {
  orchestrator?: TokenUsageAggregate;
};

export function flushRunToRows(
  out: import('../deriveRows.js').Row[],
  openRun: OpenRun | null,
  openRunUsage: OpenRunUsage | null
): { openRun: OpenRun | null; openRunUsage: OpenRunUsage | null } {
  if (!openRun) return { openRun, openRunUsage };
  const durationMs = openRun.lastTs - openRun.promptTs;
  if (durationMs > 0) {
    const usage = openRunUsage?.orchestrator;
    const editCount = openRun.editCount;
    const fileCount = openRun.filePaths.size;
    out.push({
      kind: 'run-complete',
      key: `run:${openRun.promptId}`,
      durationMs,
      completedAt: openRun.lastTs,
      ...(usage !== undefined ? { usage } : {}),
      ...(editCount > 0 ? { editCount } : {}),
      ...(fileCount > 0 ? { fileCount } : {})
    });
  }
  return { openRun: null, openRunUsage: null };
}
