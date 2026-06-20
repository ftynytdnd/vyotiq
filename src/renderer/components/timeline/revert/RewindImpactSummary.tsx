/**
 * Compact rewind impact line for inline prompt edit / revert.
 * Rewind trims the transcript and restores on-disk files from checkpoint blobs
 * (best-effort git/disk fallback when blobs are missing).
 */

import { History, MessageSquare } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';

export interface RewindImpactTotals {
  additions: number;
  deletions: number;
  fileCount: number;
  runCount: number;
  everyAlreadyReverted: boolean;
  legacyBlobCount: number;
}

/** Aggregate per-file stats from a rewind preview manifest. */
export function computeRewindImpactTotals(
  files: ReadonlyArray<{
    additions: number;
    deletions: number;
    alreadyReverted: boolean;
    blobMissing?: boolean;
  }>,
  runCount: number
): RewindImpactTotals {
  let additions = 0;
  let deletions = 0;
  let alreadyReverted = 0;
  let legacyBlobCount = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
    if (f.alreadyReverted) alreadyReverted += 1;
    if (f.blobMissing) legacyBlobCount += 1;
  }
  return {
    additions,
    deletions,
    fileCount: files.length,
    runCount,
    everyAlreadyReverted:
      files.length > 0 && alreadyReverted === files.length,
    legacyBlobCount
  };
}

export function RewindImpactSummary({
  transcriptEventsAffected,
  fileCount,
  additions,
  deletions,
  runCount,
  legacyBlobCount,
  className
}: RewindImpactTotals & {
  transcriptEventsAffected: number;
  className?: string;
}) {
  const hasLegacyFileStats = fileCount > 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-muted', className)}>
      <span className="text-text-secondary">
        Trims the chat transcript from this message onward and restores workspace files from
        checkpoints when available.
      </span>
      <span className="inline-flex items-center gap-1">
        <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <span>
          {transcriptEventsAffected} event{transcriptEventsAffected === 1 ? '' : 's'} removed
        </span>
      </span>
      {runCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <History className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          <span>
            {runCount} run{runCount === 1 ? '' : 's'} after this point
          </span>
        </span>
      )}
      {hasLegacyFileStats && (
        <span className="text-text-muted/80">
          {fileCount} file{fileCount === 1 ? '' : 's'} to restore
          {fileCount > 0 ? ` (+${additions} −${deletions} lines)` : ''}
        </span>
      )}
      {legacyBlobCount > 0 && (
        <span className="text-warning-strong">
          {legacyBlobCount} legacy snapshot{legacyBlobCount === 1 ? '' : 's'} missing — git
          fallback may apply
        </span>
      )}
    </div>
  );
}
