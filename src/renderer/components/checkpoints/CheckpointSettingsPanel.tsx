/**
 * Checkpoint settings panel — Settings → Checkpoints tab in the
 * secondary zone.
 *
 * Exposes disk-usage summary, prune/clear, and export archive actions.
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellFieldLabel,
  ShellRow,
  ShellRowSplit,
  ShellSection
} from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { chromeListEmptyClassName } from '../ui/SurfaceShell.js';
import { formatBytes } from './formatBytes.js';

export function CheckpointSettingsPanel({ embedded: _embedded = false }: { embedded?: boolean }) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const summary = useCheckpointsStore((s) =>
    activeWorkspaceId ? s.summaryByWorkspace[activeWorkspaceId] : undefined
  );
  const refreshSummary = useCheckpointsStore((s) => s.refreshSummary);
  const exportArchive = useCheckpointsStore((s) => s.exportArchive);
  const prune = useCheckpointsStore((s) => s.prune);
  const showToast = useToastStore((s) => s.show);
  const openCheckpointHistory = useSecondaryZoneStore((s) => s.openCheckpoints);

  const [pruneDays, setPruneDays] = useState('30');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, refreshSummary]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const onExport = async () => {
    if (!activeWorkspaceId) return;
    try {
      const result = await exportArchive(activeWorkspaceId);
      showToast(`Exported to ${result.archivePath}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Export failed: ${msg}`, 'danger');
    }
  };

  const onPrune = async () => {
    if (!activeWorkspaceId) return;
    const days = Number.parseInt(pruneDays, 10);
    if (!Number.isFinite(days) || days < 0) {
      showToast('Enter a non-negative number of days.', 'danger');
      return;
    }
    try {
      const result = await prune(activeWorkspaceId, days);
      showToast(
        `Pruned ${result.removedRuns} run${result.removedRuns === 1 ? '' : 's'} (${result.removedBlobs} snapshot${result.removedBlobs === 1 ? '' : 's'} reclaimed).`,
        'success'
      );
      await refreshSummary(activeWorkspaceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Prune failed: ${msg}`, 'danger');
    }
  };

  const onClearAll = async () => {
    setConfirmClear(false);
    if (!activeWorkspaceId) return;
    try {
      const result = await prune(activeWorkspaceId, 0);
      showToast(
        `Cleared every checkpoint for this workspace (${result.removedRuns} runs, ${result.removedBlobs} snapshots).`,
        'success'
      );
      await refreshSummary(activeWorkspaceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Clear failed: ${msg}`, 'danger');
    }
  };

  const formattedSize = useMemo(
    () => formatBytes(summary?.usage.totalBytes ?? 0),
    [summary?.usage.totalBytes]
  );

  if (!activeWorkspaceId) {
    return (
      <div className={chromeListEmptyClassName}>
        Select a workspace to manage its checkpoints.
      </div>
    );
  }

  const openPermissionsSettings = useSecondaryZoneStore((s) => s.openSettings);

  return (
    <>
      <ShellRow>
        <button type="button" onClick={() => openCheckpointHistory()} className="vx-btn vx-btn-text">
          View checkpoint history…
        </button>
      </ShellRow>
      <ShellSection title="Pending on send">
        <ShellCaption>
          Unresolved pending rows can block send or be auto-accepted when you start a new message.
          Per-workspace defaults are gate off and auto-accept on, so the next send may accept many
          rows at once unless you change it.
        </ShellCaption>
        <ShellRow>
          <button
            type="button"
            onClick={() => openPermissionsSettings('permissions')}
            className="vx-btn vx-btn-text"
          >
            Checkpoint gates in Settings…
          </button>
        </ShellRow>
      </ShellSection>
      <ShellSection title="Storage">
        <ShellRow>
          <div className="vx-stat">
            <ShellFieldLabel>Disk usage</ShellFieldLabel>
            <div className="vx-stat-value">{summary ? formattedSize : 'Loading…'}</div>
            {summary && (
              <p className="vx-caption mt-1">
                {summary.runs.length} run{summary.runs.length === 1 ? '' : 's'} ·{' '}
                {summary.files.length} file{summary.files.length === 1 ? '' : 's'} ·{' '}
                {summary.usage.blobCount} snapshot{summary.usage.blobCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </ShellRow>
        <ShellRow>
          <ShellRowSplit
            main={
              <>
                <ShellFieldLabel htmlFor="checkpoint-prune-days">
                  Prune older than (days)
                </ShellFieldLabel>
                <ShellCaption>Remove checkpoint runs older than this many days.</ShellCaption>
              </>
            }
            control={
              <div className="flex flex-wrap items-center gap-2">
                <TextField
                  id="checkpoint-prune-days"
                  type="number"
                  appearance="boxed"
                  size="sm"
                  min={1}
                  value={pruneDays}
                  onChange={(e) => setPruneDays(e.target.value)}
                  placeholder="30"
                  className="w-16 font-mono text-right"
                />
                <Button variant="primary" disabled={pruneDays === '30'} onClick={() => void onPrune()}>
                  Prune
                </Button>
              </div>
            }
          />
        </ShellRow>
        {confirmClear ? (
          <DestructiveConfirm
            variant="inline"
            open
            context={activeWorkspace?.label ?? activeWorkspaceId}
            question="Clear all checkpoints?"
            confirmLabel="Clear all"
            onConfirm={() => void onClearAll()}
            onCancel={() => setConfirmClear(false)}
          />
        ) : (
          <ShellActionRow>
            <Button variant="secondary" onClick={() => void onExport()}>
              <Download className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              Export archive
            </Button>
            <Button variant="danger" onClick={() => setConfirmClear(true)}>
              <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              Clear all
            </Button>
          </ShellActionRow>
        )}
      </ShellSection>
    </>
  );
}
