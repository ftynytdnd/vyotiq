/**
 * Compact rewind impact line for inline prompt edit / revert.
 */

import { FileWarning, History, MessageSquare } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';

export interface RewindImpactTotals {
  additions: number;
  deletions: number;
  fileCount: number;
  runCount: number;
  everyAlreadyReverted: boolean;
}

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
  everyAlreadyReverted,
  className
}: RewindImpactTotals & {
  transcriptEventsAffected: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-muted', className)}>
      {everyAlreadyReverted && (
        <span className="text-text-secondary">Workspace files already match this point.</span>
      )}
      <span className="inline-flex items-center gap-1">
        <FileWarning className={cn(SHELL_ROW_ICON_CLASS, 'text-warning')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <span>
          {fileCount} file{fileCount === 1 ? '' : 's'} touched
          {fileCount > 0 ? ` (+${additions} −${deletions})` : ''}
        </span>
      </span>
      {runCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <History className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          <span>
            {runCount} run{runCount === 1 ? '' : 's'}
          </span>
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <span>
          {transcriptEventsAffected} event{transcriptEventsAffected === 1 ? '' : 's'} removed
        </span>
      </span>
    </div>
  );
}
