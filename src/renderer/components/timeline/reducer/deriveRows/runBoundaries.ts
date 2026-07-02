import type { TokenUsageAggregate } from '../types.js';
import type { Row } from '../deriveRows.js';

export type OpenRun = {
  promptId: string;
  promptTs: number;
  lastTs: number;
  editCount: number;
  filePaths: Set<string>;
  /** Successful `bash` tool results in this run. */
  commandCount: number;
  /** Hidden `continue` tool invocations in this run. */
  continuedCount: number;
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
    promptId: string;
    durationMs: number;
    completedAt: number;
    usage?: TokenUsageAggregate;
    editCount: number;
    fileCount: number;
    commandCount: number;
  }
): void {
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i];
    if (row?.kind === 'error' && row.key === errorKey) {
      out[i] = {
        ...row,
        promptId: meta.promptId,
        durationMs: meta.durationMs,
        completedAt: meta.completedAt,
        ...(meta.usage !== undefined ? { usage: meta.usage } : {}),
        ...(meta.editCount > 0 ? { editCount: meta.editCount } : {}),
        ...(meta.fileCount > 0 ? { fileCount: meta.fileCount } : {}),
        ...(meta.commandCount > 0 ? { commandCount: meta.commandCount } : {})
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
  const durationMs = Math.max(0, openRun.lastTs - openRun.promptTs);
  const usage = openRunUsage?.orchestrator;
  const editCount = openRun.editCount;
  const fileCount = openRun.filePaths.size;
  const commandCount = openRun.commandCount;
  const meta = {
    durationMs,
    completedAt: openRun.lastTs,
    ...(usage !== undefined ? { usage } : {}),
    editCount,
    fileCount,
    commandCount
  };
  if (openRun.endedInError && openRun.errorKey) {
    enrichErrorRowWithRunMeta(out, openRun.errorKey, { ...meta, promptId: openRun.promptId });
  } else if (durationMs > 0) {
    out.push({
      kind: 'run-complete',
      key: `run:${openRun.promptId}`,
      promptId: openRun.promptId,
      durationMs,
      completedAt: openRun.lastTs,
      ...(usage !== undefined ? { usage } : {}),
      ...(editCount > 0 ? { editCount } : {}),
      ...(fileCount > 0 ? { fileCount } : {}),
      ...(commandCount > 0 ? { commandCount } : {}),
      ...(openRun.continuedCount > 0 ? { continued: true } : {})
    });
  }
  return { openRun: null, openRunUsage: null };
}
