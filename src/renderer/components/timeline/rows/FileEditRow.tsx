/**
 * File-edit log-line. Flush row rendered under `FileEditGroupRow` when
 * a group is expanded — matches the `InvocationShell` rhythm so file
 * edits and tool invocations read as a single timeline column.
 *
 * Checkpointed edits are recorded on disk for rewind; this row surfaces
 * path, stats, and a hover-gated Open affordance.
 */

import { ArrowUpRight, FileCode } from 'lucide-react';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { timelineRowHeaderClassName, timelineActionPillClassName } from '../shared/rowStyles.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';

interface FileEditRowProps {
  filePath: string;
  additions: number;
  deletions: number;
}

export function FileEditRow({ filePath, additions, deletions }: FileEditRowProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  const handleOpen = async () => {
    await openWorkspaceFile(filePath, {
      ...(workspaceId ? { workspaceId } : {}),
      context: 'file-edit'
    });
  };

  return (
    <div className={cn('group flex items-center gap-1', timelineRowHeaderClassName)}>
      <FileCode className={cn(SHELL_ROW_ICON_CLASS, 'text-accent')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div
        className="min-w-0 flex-1 truncate vx-provider-meta text-text-primary"
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
          timelineActionPillClassName,
          'shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
      >
        Open
        <ArrowUpRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
    </div>
  );
}
