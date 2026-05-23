/**
 * Data plumbing for the pending-changes timeline row — refresh, filters,
 * gate state, expand persistence, and bulk actions.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useCheckpointsStore,
  usePendingChanges
} from '../../../store/useCheckpointsStore.js';
import { useSettingsStore } from '../../../store/useSettingsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { usePendingChangesFilters } from '../pending/usePendingChangesFilters.js';
import { applyPendingFilters } from '../pending/groupPendingByPath.js';
import { formatBytes } from '../formatBytes.js';

export const PENDING_CHANGES_ROW_KEY = 'pending-changes';

export function usePendingChangesTimelineRow(conversationId: string | null) {
  const pending = usePendingChanges(conversationId);
  const refreshPending = useCheckpointsStore((s) => s.refreshPending);
  const acceptAllPending = useCheckpointsStore((s) => s.acceptAll);
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

  const persistedExpanded = useTimelineUiStore((s) =>
    s.isExpanded(conversationId, PENDING_CHANGES_ROW_KEY)
  );
  const userOverridden = useTimelineUiStore((s) =>
    s.hasManualOverride(conversationId, PENDING_CHANGES_ROW_KEY)
  );
  const setExpanded = useTimelineUiStore((s) => s.setExpanded);

  const filters = usePendingChangesFilters(conversationId);
  const [reviewOpen, setReviewOpen] = useState(false);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    if (!conversationId) return;
    void refreshPending(conversationId);
  }, [conversationId, refreshPending]);

  useEffect(() => {
    if (pending.length === 0) return;
    if (!activeWorkspaceId) return;
    if (summary) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, pending.length, summary, refreshSummary]);

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

  const visiblePending = useMemo(
    () =>
      applyPendingFilters(pending, {
        runId: filters.runId,
        pathQuery: filters.pathQuery
      }),
    [pending, filters.runId, filters.pathQuery]
  );

  const gateAutoExpand = gateOn && pending.length > 0;
  const expanded = userOverridden ? persistedExpanded : gateAutoExpand || persistedExpanded;

  const onToggleExpand = () => {
    if (!conversationId) return;
    setExpanded(conversationId, PENDING_CHANGES_ROW_KEY, !expanded);
  };

  const onAcceptAll = async () => {
    if (!conversationId) return;
    const ok = await acceptAllPending(conversationId);
    if (!ok) {
      showToast('Some changes could not be accepted — see Checkpoints log', 'danger');
    }
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

  const visibleAdditions = visiblePending.reduce((a, p) => a + p.additions, 0);
  const visibleDeletions = visiblePending.reduce((a, p) => a + p.deletions, 0);

  const usageLabel = summary
    ? `Checkpoints · ${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'}`
    : null;
  const usageTitle = summary
    ? `${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'} · ${formatBytes(summary.usage.totalBytes)} on disk — open Checkpoints view`
    : null;

  return {
    pending,
    visiblePending,
    visibleAdditions,
    visibleDeletions,
    gateOn,
    runIds,
    filters,
    expanded,
    onToggleExpand,
    reviewOpen,
    setReviewOpen,
    onAcceptAll,
    onRejectAll,
    usageLabel,
    usageTitle,
    hasEntries: Boolean(conversationId && pending.length > 0)
  };
}
