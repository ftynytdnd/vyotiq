/**
 * One pending change. Header row with file path + diff stats +
 * Accept / Reject / Open affordances; expandable detail pane with
 * the full diff via the modular `DiffViewer`.
 *
 * Visual rhythm reuses `InvocationShell`'s log-line cadence so the
 * pending panel reads as a sibling of the timeline rather than a
 * card-styled overlay.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus, FileCode, PencilLine, Trash2 } from 'lucide-react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { Button } from '../ui/Button.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { PendingChangeDiff } from './PendingChangeDiff.js';
import { openWorkspaceFile } from '../../lib/openPath.js';
import { cn } from '../../lib/cn.js';
import { timelineRowHeaderClassName } from '../timeline/shared/rowStyles.js';

function PendingChangeAttribution({ change }: { change: PendingChange }) {
  if (change.source !== 'bash' && !change.subagentId) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {change.source === 'bash' && (
        <span
          className="rounded-inner bg-surface-overlay px-1 font-mono text-meta uppercase text-text-muted"
          title="Recovered from a bash command"
        >
          bash
        </span>
      )}
      {change.subagentId && (
        <span
          className="rounded-inner bg-surface-overlay/60 px-1 font-mono text-meta text-text-faint"
          title={`Sub-agent ${change.subagentId}`}
        >
          {change.subagentId}
        </span>
      )}
    </span>
  );
}

interface PendingChangeRowProps {
  change: PendingChange;
  /**
   * When true, the row mounts in always-expanded mode and skips the
   * collapse chevron — used by the "Review all" lightbox so a single
   * change stays readable without an extra click.
   */
  alwaysExpanded?: boolean;
}

export function PendingChangeRow({
  change,
  alwaysExpanded = false
}: PendingChangeRowProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const accept = useCheckpointsStore((s) => s.accept);
  const reject = useCheckpointsStore((s) => s.reject);
  const showToast = useToastStore((s) => s.show);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const open = alwaysExpanded || expanded;

  const Icon =
    change.kind === 'create' ? FilePlus : change.kind === 'delete' ? Trash2 : PencilLine;
  const verb =
    change.kind === 'create' ? 'Created' : change.kind === 'delete' ? 'Deleted' : 'Modified';
  const pathIndex = Math.max(change.filePath.lastIndexOf('/'), change.filePath.lastIndexOf('\\'));
  const fileName = pathIndex >= 0 ? change.filePath.slice(pathIndex + 1) : change.filePath;
  const dirName = pathIndex >= 0 ? change.filePath.slice(0, pathIndex + 1) : '';

  const onAccept = () => {
    void accept(change.entryId, change.conversationId).then((ok) => {
      if (!ok) {
        showToast(`Could not accept change for ${change.filePath}`, 'danger');
      }
    });
  };
  const onReject = async () => {
    const result = await reject(change.entryId, change.conversationId);
    if (!result.ok) {
      const msg =
        result.error.kind === 'blob-missing'
          ? `Snapshot missing — cannot revert ${change.filePath}.`
          : result.error.kind === 'fs'
            ? `Revert failed: ${result.error.message}`
            : result.error.kind === 'sandbox'
              ? `Revert blocked by sandbox: ${result.error.message}`
              : `Revert failed (${result.error.kind}).`;
      showToast(msg, 'danger');
    } else {
      showToast(`Reverted ${change.filePath}`, 'success');
    }
  };

  const canOpenInEditor = change.kind !== 'delete';
  const onOpenFile = () => {
    if (!canOpenInEditor) return;
    void openWorkspaceFile(change.filePath, {
      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
      context: 'pending-change'
    });
  };

  return (
    <div className="vyotiq-stepfade group flex flex-col">
      <div className={timelineRowHeaderClassName}>
        {!alwaysExpanded && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="app-no-drag flex items-center gap-1 rounded-inner text-text-muted hover:text-text-primary"
            aria-label={open ? 'Collapse diff' : 'Expand diff'}
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
        )}
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
        <div className="min-w-0 flex-1 truncate text-row text-text-secondary" title={change.filePath}>
          <span className="font-medium text-text-primary">{verb}</span>{' '}
          {dirName && <span className="font-mono text-text-faint">{dirName}</span>}
          <span className="font-mono text-text-secondary">{fileName}</span>
        </div>
        <PendingChangeAttribution change={change} />
        <DiffStatsBadge
          additions={change.additions}
          deletions={change.deletions}
          minWidth="badge"
        />
        <div
          className={cn(
            'ml-1 flex shrink-0 gap-1 transition-opacity duration-150',
            alwaysExpanded
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          )}
        >
          {canOpenInEditor && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onOpenFile}
              aria-label={`Open ${change.filePath} in editor`}
              title="Open in editor"
            >
              <FileCode className="h-3 w-3" strokeWidth={2.25} />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onReject} aria-label={`Reject ${change.filePath}`}>
            Reject
          </Button>
          <Button size="sm" variant="secondary" onClick={onAccept} aria-label={`Accept ${change.filePath}`}>
            Accept
          </Button>
        </div>
      </div>
      {open && (
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
