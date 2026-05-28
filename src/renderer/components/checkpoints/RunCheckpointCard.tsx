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
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { PendingChangeDiff } from './PendingChangeDiff.js';
import { formatTimestamp } from './formatTimestamp.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import {
  chromeFileKindBadgeClassName,
  appComposerShellClassName
} from '../ui/SurfaceShell.js';
import {
  pendingDiffInsetClassName,
  pendingExpandButtonClassName
} from './pending/pendingPanelStyles.js';

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
    <div className={cn(appComposerShellClassName, 'group flex flex-col gap-0')}>
      <div className="vx-row flex w-full min-w-0 items-center gap-1.5 px-2 py-1">
        {confirmRevert ? (
          <DestructiveConfirm
            variant="inline"
            open
            context={runHead.label}
            question={
              runHead.endedAt === null
                ? 'Revert this run? It is still marked running.'
                : `Revert "${runHead.label}"?`
            }
            confirmLabel="Revert run"
            onConfirm={() => void onRevertRun()}
            onCancel={() => setConfirmRevert(false)}
          />
        ) : confirmDelete ? (
          <DestructiveConfirm
            variant="inline"
            open
            context={runHead.label}
            question={
              runHead.endedAt === null
                ? 'Delete this run? It is still marked running.'
                : `Delete run "${runHead.label}"?`
            }
            confirmLabel="Delete run"
            onConfirm={() => void onDeleteRun()}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={pendingExpandButtonClassName}
          aria-label={expanded ? 'Collapse run' : 'Expand run'}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate vx-row-label" title={runHead.label}>
            {runHead.label}
          </div>
          <div className="vx-caption">
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
              <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              Revert run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              title="Delete this run from the checkpoint store"
              className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              Delete
            </Button>
          </>
        )}
      </div>
      {expanded && manifest && (
        <ul className="flex flex-col gap-0.5">
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
    </div>
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
      <div className="vx-row flex w-full min-w-0 items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={pendingExpandButtonClassName}
          aria-label={open ? 'Collapse entry diff' : 'Expand entry diff'}
        >
          {open ? (
            <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
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
        <div className={cn(pendingDiffInsetClassName, 'mx-3 mb-2 mt-0')}>
          <div className="px-2 py-1.5">
            <PendingChangeDiff
            workspaceId={workspaceId}
            kind={entry.kind}
            {...(entry.preHash ? { preHash: entry.preHash } : {})}
            {...(entry.postHash ? { postHash: entry.postHash } : {})}
          />
          </div>
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
