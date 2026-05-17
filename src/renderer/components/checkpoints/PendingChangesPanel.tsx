/**
 * PendingChangesPanel — inline panel between the timeline and
 * composer. Surfaces every Accept / Reject candidate for the active
 * conversation with a sticky header, optional run + path filters,
 * a virtualisation-light list, and a "Review all" lightbox for
 * one-at-a-time review.
 *
 * Renders nothing when the conversation has no pending entries —
 * the chat surface stays clean for the common case. Checkpoint
 * history remains available from the sidebar and full Checkpoints
 * view.
 *
 * Header copy adapts to `gatePromptOnPendingByWorkspace`:
 *   - off (default): "auto-accepted on next message"
 *   - on:            "approve or reject before sending"
 *
 * Implementation broken up into modular files inside `pending/`:
 *
 *   - `PendingChangesHeader`     — sticky header with filters + bulk.
 *   - `PendingChangesList`       — runId-grouped body + virtualisation.
 *   - `PendingChangesReviewMode` — full-pane lightbox.
 *   - `usePendingChangesFilters` — filter state hook.
 *   - `groupPendingByPath`       — pure run / folder grouping helpers.
 *
 * This file owns the data plumbing (refresh, summary warm-up,
 * accept-all / reject-all bulk actions) and orchestrates the modular
 * UI pieces.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useCheckpointsStore,
  usePendingChanges
} from '../../store/useCheckpointsStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { PendingChangesHeader } from './pending/PendingChangesHeader.js';
import { PendingChangesList } from './pending/PendingChangesList.js';
import { PendingChangesReviewMode } from './pending/PendingChangesReviewMode.js';
import { usePendingChangesFilters } from './pending/usePendingChangesFilters.js';
import { applyPendingFilters } from './pending/groupPendingByPath.js';

interface PendingChangesPanelProps {
  conversationId: string | null;
  /** Opens the full Checkpoints view modal. */
  onOpenCheckpoints?: () => void;
}

export function PendingChangesPanel({
  conversationId,
  onOpenCheckpoints
}: PendingChangesPanelProps) {
  const pending = usePendingChanges(conversationId);
  const refreshPending = useCheckpointsStore((s) => s.refreshPending);
  const refreshSummary = useCheckpointsStore((s) => s.refreshSummary);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const summary = useCheckpointsStore((s) =>
    activeWorkspaceId ? s.summaryByWorkspace[activeWorkspaceId] : undefined
  );
  const gateOn = useSettingsStore((s) =>
    activeWorkspaceId
      ? s.settings.ui?.gatePromptOnPendingByWorkspace?.[activeWorkspaceId] === true
      : false
  );

  const filters = usePendingChangesFilters(conversationId);
  const [reviewOpen, setReviewOpen] = useState(false);
  const showToast = useToastStore((s) => s.show);

  // Refresh whenever the active conversation changes. Live updates
  // arrive via the `onChanged` broadcast wired in `App.tsx`.
  useEffect(() => {
    if (!conversationId) return;
    void refreshPending(conversationId);
  }, [conversationId, refreshPending]);

  // Warm the workspace summary so the disk-usage pill has data the
  // first time the pending panel mounts. The store identity-skips
  // no-op refetches via its `summaryLoading` map so this isn't
  // wasteful.
  useEffect(() => {
    if (pending.length === 0) return;
    if (!activeWorkspaceId) return;
    if (summary) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, pending.length, summary, refreshSummary]);

  // Distinct run ids in their original order — the panel surfaces
  // these in the run filter when ≥ 2 are present.
  const runIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of pending) {
      if (seen.has(p.runId)) continue;
      seen.add(p.runId);
      out.push(p.runId);
    }
    return out;
  }, [pending]);

  // Pre-filter pending list (run + path filters).
  const visiblePending = useMemo(
    () =>
      applyPendingFilters(pending, {
        runId: filters.runId,
        pathQuery: filters.pathQuery
      }),
    [pending, filters.runId, filters.pathQuery]
  );

  // Empty-state branch: no pending entries.
  if (!conversationId) return null;
  if (pending.length === 0) return null;

  const visibleAdditions = visiblePending.reduce((a, p) => a + p.additions, 0);
  const visibleDeletions = visiblePending.reduce((a, p) => a + p.deletions, 0);

  // Bulk actions surface failure counts via toast. Per-entry `accept`
  // / `reject` log + refetch internally, so a silent bulk path used to
  // leave the user wondering why some entries reappeared after Accept
  // all. Counting `false` results (accept) or `result.ok === false`
  // (reject) lets the panel emit a single user-visible summary
  // instead. (`showToast` is hoisted above the conditional early
  // returns so React's rules-of-hooks invariant holds.)
  const onAcceptAll = async () => {
    const results = await Promise.all(
      visiblePending.map((p) =>
        useCheckpointsStore.getState().accept(p.entryId, p.conversationId)
      )
    );
    const failed = results.filter((ok) => ok === false).length;
    if (failed === 0) return;
    showToast(
      `${failed} of ${results.length} change${results.length === 1 ? '' : 's'} could not be accepted — see Checkpoints log`,
      'danger'
    );
  };
  const onRejectAll = async () => {
    const results = await Promise.all(
      visiblePending.map((p) =>
        useCheckpointsStore.getState().reject(p.entryId, p.conversationId)
      )
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) return;
    showToast(
      `${failed} of ${results.length} revert${results.length === 1 ? '' : 's'} failed — see Checkpoints log`,
      'danger'
    );
  };

  const usageLabel = summary
    ? `Checkpoints · ${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'}`
    : null;
  const usageTitle = summary
    ? `${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'} · ${formatBytes(summary.usage.totalBytes)} on disk — open Checkpoints view`
    : null;

  return (
    <>
      <div className="mb-2 flex max-h-[min(34vh,20rem)] flex-col overflow-hidden rounded-inner bg-surface-raised/60">
        <PendingChangesHeader
          visibleCount={visiblePending.length}
          totalCount={pending.length}
          visibleAdditions={visibleAdditions}
          visibleDeletions={visibleDeletions}
          gateOn={gateOn}
          runIds={runIds}
          selectedRunId={filters.runId}
          onSelectRunId={filters.setRunId}
          pathQuery={filters.pathQuery}
          onPathQueryChange={filters.setPathQuery}
          usageLabel={usageLabel}
          usageTitle={usageTitle}
          {...(onOpenCheckpoints ? { onOpenCheckpoints } : {})}
          onAcceptAll={onAcceptAll}
          onRejectAll={onRejectAll}
          onReviewAll={() => setReviewOpen(true)}
        />
        <div className="scrollbar-stealth flex min-h-0 flex-col overflow-y-auto py-0.5">
          {visiblePending.length === 0 ? (
            <div className="px-3 py-4 text-row text-text-muted">
              No pending changes match the current filters.
              <button
                type="button"
                onClick={filters.reset}
                className="ml-2 text-meta text-accent hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <PendingChangesList pending={visiblePending} />
          )}
        </div>
      </div>
      <PendingChangesReviewMode
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        entries={visiblePending}
      />
    </>
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
