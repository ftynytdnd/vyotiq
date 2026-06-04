/**
 * Compact rewind impact line for inline prompt edit / revert.
 * Rewind is transcript-only — workspace files on disk are unchanged.
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
}

/** @deprecated Legacy manifest rows; rewind no longer restores files. */
export function computeRewindImpactTotals(
  files: ReadonlyArray<{ additions: number; deletions: number; alreadyReverted: boolean }>,
  runCount: number
): RewindImpactTotals {
  let additions = 0;
  let deletions = 0;
  let alreadyReverted = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
    if (f.alreadyReverted) alreadyReverted += 1;
  }
  return {
    additions,
    deletions,
    fileCount: files.length,
    runCount,
    everyAlreadyReverted:
      files.length > 0 && alreadyReverted === files.length
  };
}

export function RewindImpactSummary({
  transcriptEventsAffected,
  fileCount,
  additions,
  deletions,
  runCount,
  className
}: RewindImpactTotals & {
  transcriptEventsAffected: number;
  className?: string;
}) {
  const hasLegacyFileStats = fileCount > 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-muted', className)}>
      <span className="text-text-secondary">
        Trims the chat transcript from this message onward. Files on disk are not changed.
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
          (Legacy checkpoint log: {fileCount} file{fileCount === 1 ? '' : 's'} recorded
          {fileCount > 0 ? ` +${additions} −${deletions}` : ''} — not reverted on disk.)
        </span>
      )}
    </div>
  );
}
