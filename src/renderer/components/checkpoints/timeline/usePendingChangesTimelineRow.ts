/**
 * Data plumbing for the pending-changes timeline row — refresh, filters,
 * gate state, expand persistence, and bulk actions.
 */

import { useEffect, useMemo } from 'react';
import {
  useCheckpointsStore,
  usePendingChanges
} from '../../../store/useCheckpointsStore.js';
import { useSettingsStore } from '../../../store/useSettingsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { usePendingChangesFilters } from '../pending/usePendingChangesFilters.js';
import { applyPendingFilters, countDistinctFilePaths } from '../pending/groupPendingByPath.js';
import { formatBytes } from '../formatBytes.js';

const PENDING_CHANGES_ROW_KEY = 'pending-changes';

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
  const setExpanded = useTimelineUiStore((s) => s.setExpanded);

  const filters = usePendingChangesFilters(conversationId);
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

  const expanded = persistedExpanded;

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
    const ordered = [...visiblePending].sort((a, b) => b.createdAt - a.createdAt);
    let failed = 0;
    for (const p of ordered) {
      const result = await useCheckpointsStore
        .getState()
        .reject(p.entryId, p.conversationId);
      if (!result.ok) failed += 1;
    }
    if (failed === 0) return;
    showToast(
      `${failed} of ${ordered.length} revert${ordered.length === 1 ? '' : 's'} failed — see Checkpoints log`,
      'danger'
    );
  };

  const visibleAdditions = visiblePending.reduce((a, p) => a + p.additions, 0);
  const visibleDeletions = visiblePending.reduce((a, p) => a + p.deletions, 0);
  const visibleFileCount = countDistinctFilePaths(visiblePending);

  const usageLabel = summary
    ? `Checkpoints · ${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'}`
    : null;
  const usageTitle = summary
    ? `${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'} · ${formatBytes(summary.usage.totalBytes)} on disk — open Checkpoints view`
    : null;

  return {
    activeWorkspaceId,
    pending,
    visiblePending,
    visibleFileCount,
    visibleAdditions,
    visibleDeletions,
    gateOn,
    runIds,
    filters,
    expanded,
    onToggleExpand,
    onAcceptAll,
    onRejectAll,
    usageLabel,
    usageTitle,
    hasEntries: Boolean(conversationId && pending.length > 0)
  };
}
