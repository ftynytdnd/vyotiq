/**
 * One file row inside the rewind-preview modal. Visual rhythm matches
 * `FileEditRow` / the previous `PendingChangeRow` so the modal reads
 * as a sibling of the timeline rather than a card-styled overlay.
 *
 * Each row is collapsible — clicking the chevron expands the diff
 * body via the shared `PendingChangeDiff` component (which also
 * powers the timeline's per-edit diff preview).
 *
 * Read-only: the rewind preview lists files that WILL be reverted on
 * confirm, so there are no per-row Accept / Reject buttons here. The
 * single confirm button at the modal footer is the only action.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus, PencilLine, Trash2, Undo2 } from 'lucide-react';
import type { RewindFileChange } from '@shared/types/checkpoint.js';
import { PendingChangeDiff } from '../../checkpoints/PendingChangeDiff.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
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
    <div className="vyotiq-stepfade flex flex-col">
      <div className="log-line flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="app-no-drag flex items-center gap-1 rounded-inner text-text-muted hover:text-text-primary"
          aria-label={expanded ? 'Collapse diff' : 'Expand diff'}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
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
            className="inline-flex shrink-0 items-center gap-1 rounded-inner bg-surface-overlay px-1.5 py-0.5 text-meta text-text-muted"
            title="This entry was already reverted manually"
          >
            <Undo2 className="h-3 w-3" strokeWidth={2.25} />
            Reverted
          </span>
        )}
        <DiffStatsBadge
          additions={change.additions}
          deletions={change.deletions}
          className="w-16 shrink-0 justify-end"
        />
      </div>
      {expanded && (
        <div className="px-3 pb-2 pt-1">
          <PendingChangeDiff
            workspaceId={change.workspaceId}
            kind={change.kind}
            {...(change.preHash ? { preHash: change.preHash } : {})}
            {...(change.postHash ? { postHash: change.postHash } : {})}
          />
        </div>
      )}
    </div>
  );
}
