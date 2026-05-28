/**
 * One run's collapsible card on the Checkpoints view. Header shows
 * label + entry count + diff stats + a "Revert run" affordance.
 * Expanded view lists every entry with per-entry Revert.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import type {
  CheckpointEntry,
  CheckpointRunManifest
} from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { PendingChangeDiff } from './PendingChangeDiff.js';
import { formatTimestamp } from './formatTimestamp.js';
import { cn } from '../../lib/cn.js';
import { chromeFileKindBadgeClassName, SurfaceShell } from '../ui/SurfaceShell.js';
import { timelineRowHeaderClassName } from '../timeline/shared/rowStyles.js';

interface RunCheckpointCardProps {
  workspaceId: string;
  runHead: {
    runId: string;
    label: string;
    startedAt: number;
    endedAt: number | null;
    entryCount: number;
  };
}

export function RunCheckpointCard({ workspaceId, runHead }: RunCheckpointCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [manifest, setManifest] = useState<CheckpointRunManifest | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readRun = useCheckpointsStore((s) => s.readRun);
  const revertRun = useCheckpointsStore((s) => s.revertRun);
  const revertEntry = useCheckpointsStore((s) => s.revertEntry);
  const deleteRun = useCheckpointsStore((s) => s.deleteRun);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      const m = await readRun(workspaceId, runHead.runId);
      if (!cancelled) setManifest(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, workspaceId, runHead.runId, readRun]);

  const onRevertRun = async () => {
    setConfirmRevert(false);
    const result = await revertRun(runHead.runId);
    if (result.ok) {
      showToast(
        `Reverted ${result.reverted} change${result.reverted === 1 ? '' : 's'}.`,
        'success'
      );
      // Refetch the manifest so the UI flips entries to reverted.
      const m = await readRun(workspaceId, runHead.runId);
      setManifest(m);
    } else {
      showToast(`Revert failed: ${describeError(result.error.kind)}`, 'danger');
    }
  };

  const onRevertEntry = async (entry: CheckpointEntry) => {
    const result = await revertEntry(entry.id);
    if (result.ok) {
      showToast(`Reverted ${entry.filePath}`, 'success');
      const m = await readRun(workspaceId, runHead.runId);
      setManifest(m);
    } else {
      showToast(`Revert failed: ${describeError(result.error.kind)}`, 'danger');
    }
  };

  const onDeleteRun = async () => {
    setConfirmDelete(false);
    try {
      const result = await deleteRun(workspaceId, runHead.runId);
      if (!result.removed) {
        // The run was already gone (most likely a stale UI state where
        // a sibling tab just deleted it). Toast as info, not danger.
        showToast(`Run "${runHead.label}" was already removed.`, 'success');
        return;
      }
      const droppedNote =
        result.droppedPending > 0
          ? ` (${result.droppedPending} pending change${result.droppedPending === 1 ? '' : 's'} dropped)`
          : '';
      showToast(`Deleted run "${runHead.label}"${droppedNote}.`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Delete failed: ${msg}`, 'danger');
    }
  };

  const additions = manifest?.entries.reduce((a, e) => a + e.additions, 0) ?? 0;
  const deletions = manifest?.entries.reduce((a, e) => a + e.deletions, 0) ?? 0;
  const everyReverted =
    (manifest?.entries.length ?? 0) > 0 &&
    manifest!.entries.every((e) => e.reverted === true);

  return (
    <SurfaceShell className="group flex flex-col gap-1">
      <div className={timelineRowHeaderClassName}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="app-no-drag flex items-center gap-1 rounded-inner text-text-muted hover:text-text-primary"
          aria-label={expanded ? 'Collapse run' : 'Expand run'}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-row text-text-primary" title={runHead.label}>
            {runHead.label}
          </div>
          <div className="text-meta text-text-muted">
            {formatTimestamp(runHead.startedAt)} ·{' '}
            {runHead.entryCount} change{runHead.entryCount === 1 ? '' : 's'}
            {runHead.endedAt === null ? ' · running' : ''}
          </div>
        </div>
        {manifest && (
          <DiffStatsBadge additions={additions} deletions={deletions} minWidth="badge" />
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmRevert(true)}
          disabled={everyReverted}
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
          Revert run
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmDelete(true)}
          title="Delete this run from the checkpoint store"
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2.25} />
          Delete
        </Button>
      </div>
      {expanded && manifest && (
        <ul className="flex flex-col gap-0.5 border-t border-border-subtle/30 px-2 py-1">
          {manifest.entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              workspaceId={workspaceId}
              onRevert={() => void onRevertEntry(e)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmRevert}
        title="Revert this run?"
        message={`Roll back every file changed in "${runHead.label}". The current contents will be replaced with the snapshot taken before the run started.`}
        confirmLabel="Revert run"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void onRevertRun()}
        onCancel={() => setConfirmRevert(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this run?"
        message={`Permanently remove the audit trail for "${runHead.label}" — its manifest, snapshot blobs, and any pending rows tied to its entries. Files on disk are untouched, but you will no longer be able to revert past edits from this run.`}
        confirmLabel="Delete run"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void onDeleteRun()}
        onCancel={() => setConfirmDelete(false)}
      />
    </SurfaceShell>
  );
}

/**
 * One entry row inside an expanded run card. Header is the same
 * compact log-line as before; the row chevron toggles an inline
 * `PendingChangeDiff` so the user can audit what a completed run
 * changed without leaving the Checkpoints view.
 */
function EntryRow({
  entry,
  workspaceId,
  onRevert
}: {
  entry: CheckpointEntry;
  workspaceId: string;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="group flex flex-col">
      <div className={timelineRowHeaderClassName}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="app-no-drag flex items-center gap-1 rounded-inner text-text-muted hover:text-text-primary"
          aria-label={open ? 'Collapse entry diff' : 'Expand entry diff'}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
        <span className={chromeFileKindBadgeClassName(entry.kind)}>{entry.kind}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-row',
            entry.reverted ? 'text-text-faint line-through decoration-text-faint/60' : 'text-text-secondary'
          )}
          title={entry.filePath}
        >
          {entry.filePath}
        </span>
        <DiffStatsBadge
          additions={entry.additions}
          deletions={entry.deletions}
          minWidth="badge"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onRevert}
          disabled={entry.reverted === true}
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          Revert
        </Button>
      </div>
      {open && (
        <div className="px-6 pb-2 pt-1">
          <PendingChangeDiff
            workspaceId={workspaceId}
            kind={entry.kind}
            {...(entry.preHash ? { preHash: entry.preHash } : {})}
            {...(entry.postHash ? { postHash: entry.postHash } : {})}
          />
        </div>
      )}
    </li>
  );
}

function describeError(kind: string): string {
  switch (kind) {
    case 'blob-missing':
      return 'snapshot is missing';
    case 'sandbox':
      return 'blocked by sandbox';
    case 'unknown-entry':
      return 'entry not found';
    case 'unknown-run':
      return 'run not found';
    default:
      return 'filesystem error';
  }
}
