/**
 * Per-file history view. Shows every recorded change for one
 * workspace-relative file with a "Restore to this version" affordance
 * per row (using the row's `preHash` as the snapshot to restore).
 *
 * The user reaches this view from the file picker on `CheckpointsView`.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, GitCompare, RotateCcw } from 'lucide-react';
import type { FileHistoryRow } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { EditDiffView } from '../timeline/tools/edit/EditDiffView.js';
import { CodeBlock } from '../timeline/tools/shared/CodeBlock.js';
import { computeDiffHunksClient } from './diffClient.js';
import { formatTimestamp } from './formatTimestamp.js';
import { vyotiq } from '../../lib/ipc.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import {
  chromeFileKindBadgeClassName,
  chromeInsetNoteClassName,
  chromeListEmptyClassName
} from '../ui/SurfaceShell.js';
import { pendingDiffInsetClassName } from './pending/pendingPanelStyles.js';

interface FileHistoryListProps {
  workspaceId: string;
  filePath: string;
  embedded?: boolean;
  /** Closes the panel. */
  onBack: () => void;
}

export function FileHistoryList({
  workspaceId,
  filePath,
  embedded = false,
  onBack
}: FileHistoryListProps) {
  const [rows, setRows] = useState<FileHistoryRow[] | null>(null);
  /**
   * When set, the row identified by `entryId` is rendered with an
   * inline "compare with current on-disk" diff. The bodies are
   * fetched lazily (one blob read + one current-file read) when the
   * button is clicked. Null = collapsed for every row.
   */
  const [comparing, setComparing] = useState<string | null>(null);
  const readFileHistory = useCheckpointsStore((s) => s.readFileHistory);
  const revertFileToHash = useCheckpointsStore((s) => s.revertFileToHash);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await readFileHistory(workspaceId, filePath);
      if (!cancelled) setRows(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, filePath, readFileHistory]);

  // Most-recent-first display order. Memoised on `rows` so a parent
  // re-render (e.g. a toast firing on a sibling) doesn't re-allocate
  // the reversed array — important for files with hundreds of
  // history entries where the reverse cost is no longer free. Review
  // finding M10.
  const orderedRows = useMemo(
    () => (rows ? rows.slice().reverse() : null),
    [rows]
  );

  const restore = async (hash: string) => {
    const result = await revertFileToHash(workspaceId, filePath, hash);
    if (result.ok) {
      showToast(`Restored ${filePath} from snapshot.`, 'success');
    } else {
      showToast(`Restore failed (${result.error.kind}).`, 'danger');
    }
  };

  const openFile = async () => {
    try {
      await vyotiq.tools.openPath(filePath, workspaceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open ${filePath}: ${msg}`, 'danger');
    }
  };

  return (
    <div className="vx-stack">
      <div className="vx-row flex w-full min-w-0 items-center gap-2 px-0">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <div
          className="min-w-0 flex-1 truncate font-mono vx-row-label"
          title={filePath}
        >
          {filePath}
        </div>
        <Button size="sm" variant="ghost" onClick={() => void openFile()}>
          Open <ArrowUpRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </Button>
      </div>
      {rows === null && (
        <div className="flex items-center gap-2 text-row text-text-muted">
          <LoadingHint message="Loading history…" className="py-4" />
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className={chromeListEmptyClassName}>No recorded history for this file.</div>
      )}
      {orderedRows && orderedRows.length > 0 && (
        <ul
          className={cn(
            'scrollbar-stealth vx-memory-list',
            embedded ? 'min-h-0 flex-1' : 'max-h-[52vh]'
          )}
        >
          {orderedRows.map((r) => (
            <HistoryRow
              key={r.entryId}
              row={r}
              workspaceId={workspaceId}
              filePath={filePath}
              comparing={comparing === r.entryId}
              onToggleCompare={() =>
                setComparing((cur) => (cur === r.entryId ? null : r.entryId))
              }
              onRestore={restore}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One row in the history list. The compare-with-current affordance
 * lazily fetches both the snapshot blob (uses `postHash` when
 * present — what the file looked like AT this entry — else falls
 * back to `preHash`) and the current on-disk body, computes hunks
 * client-side, and renders them under the row.
 *
 * Loading + missing-file states are surfaced explicitly so the user
 * never sees an unexplained blank diff area.
 */
function HistoryRow({
  row,
  workspaceId,
  filePath,
  comparing,
  onToggleCompare,
  onRestore
}: {
  row: FileHistoryRow;
  workspaceId: string;
  filePath: string;
  comparing: boolean;
  onToggleCompare: () => void;
  onRestore: (hash: string) => void;
}) {
  const readBlob = useCheckpointsStore((s) => s.readBlob);
  const readCurrentFile = useCheckpointsStore((s) => s.readCurrentFile);

  const [state, setState] = useState<{
    loading: boolean;
    snapshot: string | null;
    current: string | null;
    error: string | null;
  }>({ loading: false, snapshot: null, current: null, error: null });

  useEffect(() => {
    if (!comparing) return;
    let cancelled = false;
    setState({ loading: true, snapshot: null, current: null, error: null });
    void (async () => {
      // Prefer the post-state ("what this entry produced") for the
      // comparison; fall back to pre-state for `delete` entries
      // which never had a post.
      const hash = row.postHash ?? row.preHash ?? null;
      const [snapshot, current] = await Promise.all([
        hash ? readBlob(workspaceId, hash) : Promise.resolve(null),
        readCurrentFile(workspaceId, filePath)
      ]);
      if (cancelled) return;
      setState({
        loading: false,
        snapshot,
        current,
        error: hash ? null : 'no snapshot to compare'
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [comparing, row.preHash, row.postHash, workspaceId, filePath, readBlob, readCurrentFile]);

  return (
    <li className="group flex flex-col">
      <div className="vx-memory-list-item flex w-full min-w-0 flex-wrap items-center gap-1.5 text-left">
        <span className={chromeFileKindBadgeClassName(row.kind)}>
          {row.kind}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 text-row',
            row.reverted ? 'text-text-faint line-through' : 'text-text-secondary'
          )}
        >
          {formatTimestamp(row.ts)}
        </span>
        <DiffStatsBadge
          additions={row.additions}
          deletions={row.deletions}
          minWidth="badge"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleCompare}
          title="Diff this snapshot against the current on-disk file"
          className={cn(
            'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
            comparing && 'opacity-100'
          )}
        >
          <GitCompare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          {comparing ? 'Hide' : 'Compare'}
        </Button>
        {row.preHash && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRestore(row.preHash!)}
            title="Restore the file content as it was BEFORE this change"
            className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          >
            <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Restore pre
          </Button>
        )}
        {row.postHash && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRestore(row.postHash!)}
            title="Restore the file content as it was AFTER this change"
            className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          >
            <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Restore post
          </Button>
        )}
      </div>
      {comparing && (
        <div className={cn(pendingDiffInsetClassName, 'mx-1 mb-2 mt-1')}>
          <div className="px-2 py-1.5">
            <CompareWithCurrent state={state} />
          </div>
        </div>
      )}
    </li>
  );
}

function CompareWithCurrent({
  state
}: {
  state: {
    loading: boolean;
    snapshot: string | null;
    current: string | null;
    error: string | null;
  };
}) {
  if (state.loading) {
    return (
      <div className={chromeInsetNoteClassName}>
        Loading comparison…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className={chromeInsetNoteClassName}>
        {state.error}
      </div>
    );
  }
  if (state.snapshot === null) {
    return (
      <div className={chromeInsetNoteClassName}>
        Snapshot is missing — cannot compare.
      </div>
    );
  }
  if (state.current === null) {
    // File no longer on disk. Show the snapshot in danger tone so
    // the user can still see what was there.
    return (
      <div className="flex flex-col gap-1">
        <div className="text-meta text-text-faint">
          File no longer on disk — showing the snapshot only.
        </div>
        <CodeBlock body={state.snapshot} tone="danger" />
      </div>
    );
  }
  const hunks = computeDiffHunksClient(state.snapshot, state.current);
  if (hunks.length === 0) {
    return (
      <div className={chromeInsetNoteClassName}>
        Current file matches this snapshot exactly.
      </div>
    );
  }
  return <EditDiffView hunks={hunks} variant="authoritative" />;
}

