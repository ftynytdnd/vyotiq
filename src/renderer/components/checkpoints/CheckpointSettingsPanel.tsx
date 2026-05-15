/**
 * Checkpoint settings panel — mounted inside the SettingsModal under
 * the "Checkpoints" tab.
 *
 * Exposes:
 *   - Strict-approvals toggle (per active workspace).
 *   - Disk-usage summary.
 *   - Prune (older than N days) and Clear All actions.
 *   - Export archive action.
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { TextField } from '../ui/TextField.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';

export function CheckpointSettingsPanel() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const settings = useSettingsStore((s) => s.settings);
  // The checkpoint-related toggles flow through dedicated store setters
  // (one IPC round-trip, identity-skipped on a same-value re-toggle).
  // Pre-fix, this panel reached into `vyotiq.settings.set` directly and
  // followed up with a `refreshSettings()` — two IPCs, and racy if a
  // sibling write landed between them. Routing through the store keeps
  // every settings mutation on a single uniform path.
  const setStrictApprovalsForWorkspace = useSettingsStore(
    (s) => s.setStrictApprovalsForWorkspace
  );
  const setGatePromptOnPendingForWorkspace = useSettingsStore(
    (s) => s.setGatePromptOnPendingForWorkspace
  );
  const summary = useCheckpointsStore((s) =>
    activeWorkspaceId ? s.summaryByWorkspace[activeWorkspaceId] : undefined
  );
  const refreshSummary = useCheckpointsStore((s) => s.refreshSummary);
  const exportArchive = useCheckpointsStore((s) => s.exportArchive);
  const prune = useCheckpointsStore((s) => s.prune);
  const showToast = useToastStore((s) => s.show);

  const [pruneDays, setPruneDays] = useState('30');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, refreshSummary]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const strictMap = settings.ui?.strictApprovalsByWorkspace ?? {};
  const strict = activeWorkspaceId ? strictMap[activeWorkspaceId] === true : false;
  const gateMap = settings.ui?.gatePromptOnPendingByWorkspace ?? {};
  const gate = activeWorkspaceId ? gateMap[activeWorkspaceId] === true : false;

  const setStrict = async (value: boolean) => {
    if (!activeWorkspaceId) return;
    await setStrictApprovalsForWorkspace(activeWorkspaceId, value);
  };

  const setGate = async (value: boolean) => {
    if (!activeWorkspaceId) return;
    await setGatePromptOnPendingForWorkspace(activeWorkspaceId, value);
  };

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
      <div className="text-row text-text-muted">
        Select a workspace to manage its checkpoints.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle/30 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-text-primary">Require approval before each edit</div>
          <div className="mt-0.5 text-row leading-relaxed text-text-muted">
            When on, every <code className="font-mono text-text-secondary">edit</code> /{' '}
            <code className="font-mono text-text-secondary">delete</code> tool call pauses
            the run and surfaces a full diff preview before writing to{' '}
            <span className="font-mono text-text-secondary">{activeWorkspace?.label ?? '…'}</span>.
            Accept, Deny, or Accept-all-remaining-in-this-run. When off (default), edits
            apply optimistically and show up in the pending changes panel.
          </div>
        </div>
        <Button size="sm" variant={strict ? 'primary' : 'secondary'} onClick={() => void setStrict(!strict)}>
          {strict ? 'On' : 'Off'}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-border-subtle/30 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-text-primary">Gate next prompt on pending changes</div>
          <div className="mt-0.5 text-row leading-relaxed text-text-muted">
            When on, sending a new message is BLOCKED if the conversation has unresolved
            pending changes — you must Accept or Reject each pending row before continuing.
            When off (default), the next message implicitly accepts every pending change and
            moves on (entries stay revertable from Checkpoints either way).
          </div>
        </div>
        <Button size="sm" variant={gate ? 'primary' : 'secondary'} onClick={() => void setGate(!gate)}>
          {gate ? 'On' : 'Off'}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
        <Eyebrow as="span" bold>
          Disk usage
        </Eyebrow>
        <div className="text-row text-text-secondary">
          {summary
            ? `${summary.runs.length} run${summary.runs.length === 1 ? '' : 's'} · ${summary.files.length} file${summary.files.length === 1 ? '' : 's'} · ${summary.usage.blobCount} snapshot${summary.usage.blobCount === 1 ? '' : 's'} · ${formattedSize}`
            : 'Loading…'}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
        <Eyebrow as="span" bold>
          Prune
        </Eyebrow>
        <div className="text-row text-text-muted">
          Remove every checkpoint older than the given number of days. Snapshots no longer
          referenced are reclaimed automatically.
        </div>
        <div className="flex items-center gap-2">
          <TextField
            type="number"
            min={1}
            value={pruneDays}
            onChange={(e) => setPruneDays(e.target.value)}
            size="md"
            tone="base"
            className="w-24 transition-colors duration-150 focus:bg-surface-overlay"
          />
          <span className="text-row text-text-muted">days</span>
          <Button size="sm" variant="secondary" onClick={() => void onPrune()}>
            Prune
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
        <Eyebrow as="span" bold>
          Export archive
        </Eyebrow>
        <div className="text-row text-text-muted">
          Write a single self-contained JSON bundle of every run, file index, snapshot blob,
          and pending entry into the workspace root. Useful for backup or transfer.
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => void onExport()}>
            <Download className="h-3 w-3" strokeWidth={2.25} />
            Export to workspace
          </Button>
        </div>
      </div>

      <WorkspaceCheckpointOverridesSection />

      <div className="flex flex-col gap-2 py-3">
        <Eyebrow as="span" bold>
          Danger zone
        </Eyebrow>
        <div className="text-row text-text-muted">
          Clear every checkpoint for this workspace. The current files on disk are unaffected,
          but you will no longer be able to revert past edits.
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)}>
            <Trash2 className="h-3 w-3" strokeWidth={2.25} />
            Clear all checkpoints
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all checkpoints?"
        message={`This permanently removes every recorded run, file history, and snapshot for "${activeWorkspace?.label ?? activeWorkspaceId}". Current files on disk are untouched, but past edits can no longer be reverted.`}
        confirmLabel="Clear all"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void onClearAll()}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

/**
 * Cross-workspace overrides list for the two checkpoint toggles
 * (`strictApprovalsByWorkspace`, `gatePromptOnPendingByWorkspace`).
 *
 * Mirrors the existing `WorkspaceOverridesSection` in `SettingsModal`'s
 * Permissions tab: hidden entirely when no workspace has either flag
 * set (so the typical single-workspace user never sees it), and each
 * row exposes a single `Reset` ghost button that flips the offending
 * flag(s) back off via the dedicated store setters.
 *
 * The section exists because the toggles above only apply to the
 * active workspace. Without this surface, a user with two or more
 * workspaces has no way to inspect or clear an override on a
 * non-active workspace short of switching to it — and once a
 * workspace is unreachable, the only way out would be editing
 * `settings.json` by hand.
 */
function WorkspaceCheckpointOverridesSection() {
  const settings = useSettingsStore((s) => s.settings);
  const workspaces = useWorkspaceStore((s) => s.list);
  const setStrictApprovalsForWorkspace = useSettingsStore(
    (s) => s.setStrictApprovalsForWorkspace
  );
  const setGatePromptOnPendingForWorkspace = useSettingsStore(
    (s) => s.setGatePromptOnPendingForWorkspace
  );
  const strictMap = settings.ui?.strictApprovalsByWorkspace ?? {};
  const gateMap = settings.ui?.gatePromptOnPendingByWorkspace ?? {};

  const overridden = workspaces.filter(
    (w) => strictMap[w.id] === true || gateMap[w.id] === true
  );

  if (overridden.length === 0) return null;

  const onReset = async (workspaceId: string) => {
    // Drop BOTH flags in two identity-skipped calls. The store's setters
    // short-circuit on a same-value write, so a workspace with only the
    // strict flag toggled never fires a redundant `gate: false` patch.
    await setStrictApprovalsForWorkspace(workspaceId, false);
    await setGatePromptOnPendingForWorkspace(workspaceId, false);
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
      <Eyebrow as="span" bold>
        Workspaces with overrides
      </Eyebrow>
      <div className="text-row text-text-muted">
        Workspaces below have at least one checkpoint flag turned on. Reset to clear both
        flags for that workspace; the next run there falls back to the post-hoc review
        defaults.
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {overridden.map((w) => {
          const strict = strictMap[w.id] === true;
          const gate = gateMap[w.id] === true;
          const labels: string[] = [];
          if (strict) labels.push('strict approvals');
          if (gate) labels.push('gate prompt on pending');
          return (
            <li
              key={w.id}
              className="flex items-start justify-between gap-3 rounded-inner bg-surface-base/30 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-row text-text-primary">{w.label}</div>
                <div className="mt-0.5 text-meta text-text-muted" title={w.path}>
                  {labels.join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onReset(w.id)}
                title="Reset this workspace's checkpoint overrides"
                className="inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-row text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
                <span>Reset</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
