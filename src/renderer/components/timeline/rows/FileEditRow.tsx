/**
 * File-edit log-line. Flush row rendered under `FileEditGroupRow` when
 * a group is expanded — matches the `InvocationShell` rhythm so file
 * edits and tool invocations read as a single timeline column.
 *
 * Hover reveals an `Open ↗` affordance that forwards to the main-
 * process `tools.openPath` IPC (opens the file in the OS default app).
 */

import { ArrowUpRight, FileCode } from 'lucide-react';
import { vyotiq } from '../../../lib/ipc.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { cn } from '../../../lib/cn.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { logger } from '../../../lib/logger.js';

const log = logger.child('FileEditRow');

interface FileEditRowProps {
  filePath: string;
  additions: number;
  deletions: number;
}

export function FileEditRow({ filePath, additions, deletions }: FileEditRowProps) {
  const showToast = useToastStore((s) => s.show);

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
    <div className="group log-line flex items-center gap-2 px-2 py-1">
      <FileCode className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
      <div
        className="min-w-0 flex-1 truncate font-mono text-log text-text-primary"
        title={filePath}
      >
        {filePath}
      </div>
      <DiffStatsBadge
        additions={additions}
        deletions={deletions}
        className="shrink-0"
      />
      <button
        type="button"
        onClick={() => void handleOpen()}
        className={cn(
          'app-no-drag inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-row shrink-0',
          'text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
      >
        Open
        <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}
