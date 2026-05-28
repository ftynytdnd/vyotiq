/**
 * File-edit log-line. Flush row rendered under `FileEditGroupRow` when
 * a group is expanded — matches the `InvocationShell` rhythm so file
 * edits and tool invocations read as a single timeline column.
 *
 * Accept/Reject for checkpointed edits lives in the pending-changes
 * panel at the timeline tail; this row only surfaces path, stats, and
 * a hover-gated Open affordance.
 */

import { ArrowUpRight, FileCode } from 'lucide-react';
import { vyotiq } from '../../../lib/ipc.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { PendingEntryDot } from '../../checkpoints/shared/PendingEntryDot.js';
import { usePendingEntryState } from '../../checkpoints/shared/usePendingEntryState.js';
import { cn } from '../../../lib/cn.js';
import { timelineRowHeaderClassName, timelineActionPillClassName } from '../shared/rowStyles.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { logger } from '../../../lib/logger.js';

const log = logger.child('FileEditRow');

interface FileEditRowProps {
  filePath: string;
  additions: number;
  deletions: number;
  entryId?: string;
  runId?: string;
  subagentId?: string;
}

export function FileEditRow({
  filePath,
  additions,
  deletions,
  entryId,
  runId,
  subagentId
}: FileEditRowProps) {
  const showToast = useToastStore((s) => s.show);
  const pending = usePendingEntryState({ entryId, filePath, runId, subagentId });

  const handleOpen = async () => {
    try {
      await vyotiq.tools.openPath(filePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('openPath failed', { filePath, err: msg });
      showToast(`Could not open ${filePath}: ${msg}`, 'danger');
    }
  };

  return (
    <div className={cn('group flex items-center gap-1', timelineRowHeaderClassName)}>
      <FileCode className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
      <div
        className="min-w-0 flex-1 truncate font-mono text-row text-text-primary"
        title={filePath}
      >
        {filePath}
      </div>
      <DiffStatsBadge
        additions={additions}
        deletions={deletions}
        className="shrink-0"
      />
      {pending && <PendingEntryDot />}
      <button
        type="button"
        onClick={() => void handleOpen()}
        className={cn(
          timelineActionPillClassName,
          'shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
      >
        Open
        <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}
