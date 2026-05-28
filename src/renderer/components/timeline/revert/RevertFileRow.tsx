/**
 * One file row inside the rewind-preview modal. Visual rhythm matches
 * pending file rows via `PendingFileRowShell` for grid parity.
 *
 * Read-only: the rewind preview lists files that WILL be reverted on
 * confirm, so there are no per-row Accept / Reject buttons here.
 */

import { useState } from 'react';
import { FilePlus, PencilLine, Trash2, Undo2 } from 'lucide-react';
import type { RewindFileChange } from '@shared/types/checkpoint.js';
import { PendingChangeDiff } from '../../checkpoints/PendingChangeDiff.js';
import { PendingFileRowShell } from '../../checkpoints/pending/PendingFileRowShell.js';
import { pendingDiffInsetClassName } from '../../checkpoints/pending/pendingPanelStyles.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { chromeBadgeClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';

interface RevertFileRowProps {
  change: RewindFileChange;
}

export function RevertFileRow({ change }: RevertFileRowProps) {
  const [expanded, setExpanded] = useState(false);

  const Icon =
    change.kind === 'create' ? FilePlus : change.kind === 'delete' ? Trash2 : PencilLine;
  const verb =
    change.kind === 'create'
      ? 'Created'
      : change.kind === 'delete'
        ? 'Deleted'
        : 'Modified';
  const pathIndex = Math.max(
    change.filePath.lastIndexOf('/'),
    change.filePath.lastIndexOf('\\')
  );
  const fileName =
    pathIndex >= 0 ? change.filePath.slice(pathIndex + 1) : change.filePath;
  const dirName = pathIndex >= 0 ? change.filePath.slice(0, pathIndex + 1) : '';

  return (
    <div className="vyotiq-stepfade-once flex flex-col">
      <PendingFileRowShell
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        path={
          <>
            <Icon
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                change.kind === 'create'
                  ? 'text-accent'
                  : change.kind === 'delete'
                    ? 'text-danger'
                    : 'text-text-muted'
              )}
              strokeWidth={2}
            />
            <div
              className="min-w-0 flex-1 truncate text-row text-text-secondary"
              title={change.filePath}
            >
              <span className="font-medium text-text-primary">{verb}</span>{' '}
              {dirName && <span className="font-mono text-text-faint">{dirName}</span>}
              <span className="font-mono text-text-secondary">{fileName}</span>
            </div>
            {change.alreadyReverted && (
              <span
                className={cn(chromeBadgeClassName, 'shrink-0 gap-1')}
                title="This entry was already reverted manually"
              >
                <Undo2 className="h-3 w-3" strokeWidth={2.25} />
                Reverted
              </span>
            )}
          </>
        }
        stats={
          <DiffStatsBadge
            additions={change.additions}
            deletions={change.deletions}
            minWidth="badge"
          />
        }
        actions={<span className="w-px" aria-hidden />}
      />
      {expanded && (
        <div className={pendingDiffInsetClassName}>
          <div className="px-2 py-1.5">
            <PendingChangeDiff
              workspaceId={change.workspaceId}
              kind={change.kind}
              {...(change.preHash ? { preHash: change.preHash } : {})}
              {...(change.postHash ? { postHash: change.postHash } : {})}
            />
          </div>
        </div>
      )}
    </div>
  );
}
