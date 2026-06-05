import type { TokenUsageAggregate } from '../types.js';
import type { Row } from '../deriveRows.js';

export type OpenRun = {
  promptId: string;
  promptTs: number;
  lastTs: number;
  editCount: number;
  filePaths: Set<string>;
  /** Terminal `error` event ended this run — merge stats into that row. */
  endedInError?: boolean;
  errorKey?: string;
};
export type OpenRunUsage = {
  orchestrator?: TokenUsageAggregate;
};

function enrichErrorRowWithRunMeta(
  out: Row[],
  errorKey: string,
  meta: {
    durationMs: number;
    completedAt: number;
    usage?: TokenUsageAggregate;
    editCount: number;
    fileCount: number;
  }
): void {
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i];
    if (row?.kind === 'error' && row.key === errorKey) {
      out[i] = {
        ...row,
        durationMs: meta.durationMs,
        completedAt: meta.completedAt,
        ...(meta.usage !== undefined ? { usage: meta.usage } : {}),
        ...(meta.editCount > 0 ? { editCount: meta.editCount } : {}),
        ...(meta.fileCount > 0 ? { fileCount: meta.fileCount } : {})
      };
      return;
    }
  }
}

export function flushRunToRows(
  out: Row[],
  openRun: OpenRun | null,
  openRunUsage: OpenRunUsage | null
): { openRun: OpenRun | null; openRunUsage: OpenRunUsage | null } {
  if (!openRun) return { openRun, openRunUsage };
  const durationMs = openRun.lastTs - openRun.promptTs;
  if (durationMs > 0) {
    const usage = openRunUsage?.orchestrator;
    const editCount = openRun.editCount;
    const fileCount = openRun.filePaths.size;
    const meta = {
      durationMs,
      completedAt: openRun.lastTs,
      ...(usage !== undefined ? { usage } : {}),
      editCount,
      fileCount
    };
    if (openRun.endedInError && openRun.errorKey) {
      enrichErrorRowWithRunMeta(out, openRun.errorKey, meta);
    } else {
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
  }
  return { openRun: null, openRunUsage: null };
}
