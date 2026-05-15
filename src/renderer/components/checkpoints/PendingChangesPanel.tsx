/**
 * PendingChangesPanel — inline panel between the timeline and composer.
 * Surfaces every Accept/Reject candidate for the active conversation
 * with a compact header and per-row affordances.
 *
 * Renders nothing when the conversation has no pending entries — the
 * chat surface stays clean for the common case. Checkpoint history
 * remains available from the sidebar and full Checkpoints view.
 *
 * Header copy adapts to `gatePromptOnPendingByWorkspace`:
 *   - off (default): "auto-accepted on next message"
 *   - on:            "approve or reject before sending"
 *
 * When >1 distinct runs are represented, rows group under collapsible
 * run-label sub-headers; a single run renders flush as before to
 * preserve the existing visual density.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import {
  useCheckpointsStore,
  usePendingChanges
} from '../../store/useCheckpointsStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { Button } from '../ui/Button.js';
import { PendingChangeRow } from './PendingChangeRow.js';

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

  // Refresh whenever the active conversation changes. Live updates
  // arrive via the `onChanged` broadcast wired in `App.tsx`.
  useEffect(() => {
    if (!conversationId) return;
    void refreshPending(conversationId);
  }, [conversationId, refreshPending]);

  // Warm the workspace summary so the disk-usage pill has data the
  // first time the pending panel mounts. The store identity-skips no-op
  // refetches via its `summaryLoading` map so this isn't wasteful.
  useEffect(() => {
    if (pending.length === 0) return;
    if (!activeWorkspaceId) return;
    if (summary) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, pending.length, summary, refreshSummary]);

  // Group rows by `runId` so users can see WHICH run produced each
  // batch of pending changes when one conversation triggered multiple
  // runs (e.g. an aborted-then-resumed sequence). Single-run case
  // skips the sub-headers below.
  const groups = useMemo(() => groupByRun(pending), [pending]);

  // Empty-state branch: no pending entries.
  if (!conversationId) return null;
  if (pending.length === 0) return null;

  const additions = pending.reduce((acc, p) => acc + p.additions, 0);
  const deletions = pending.reduce((acc, p) => acc + p.deletions, 0);

  const onAcceptAll = () => {
    void Promise.all(
      pending.map((p) =>
        useCheckpointsStore.getState().accept(p.entryId, p.conversationId)
      )
    );
  };
  const onRejectAll = () => {
    void Promise.all(
      pending.map((p) =>
        useCheckpointsStore.getState().reject(p.entryId, p.conversationId)
      )
    );
  };

  const usageLabel = summary
    ? `Checkpoints · ${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'}`
    : '';
  const usageTitle = summary
    ? `${summary.usage.runCount} run${summary.usage.runCount === 1 ? '' : 's'} · ${formatBytes(summary.usage.totalBytes)} on disk — open Checkpoints view`
    : 'Open Checkpoints view';
  const gateLabel = gateOn
    ? 'approve or reject before sending'
    : 'auto-accepted on next message';
  // When only one change is pending the body row already carries the
  // `+X −Y` stat next to its filename. Repeating the same stat in the
  // header reads as duplicate noise; drop the diff fragment in that
  // single-change case so the header stays focused on "1 pending
  // change · auto-accepted on next message".
  const showHeaderDiff = pending.length > 1;

  return (
    <div className="mb-2 flex max-h-[min(34vh,20rem)] flex-col overflow-hidden rounded-inner bg-surface-raised/60">
      <div className="log-line flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle/30 px-3 py-2">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
        <div className="min-w-0 flex-1 basis-52 text-row text-text-secondary">
          <span className="font-medium text-text-primary">
            {pending.length} pending change{pending.length === 1 ? '' : 's'}
          </span>{' '}
          <span className="text-text-muted">
            {showHeaderDiff && <>+{additions} −{deletions} · </>}
            {gateLabel}
          </span>
        </div>
        {usageLabel && onOpenCheckpoints && (
          <button
            type="button"
            onClick={onOpenCheckpoints}
            className="shrink-0 text-meta text-text-muted hover:text-text-primary"
            title={usageTitle}
          >
            {usageLabel}
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onRejectAll}>
            Reject all
          </Button>
          <Button size="sm" variant="primary" onClick={onAcceptAll}>
            Accept all
          </Button>
        </div>
      </div>
      <div className="scrollbar-stealth flex min-h-0 flex-col overflow-y-auto py-0.5">
        {groups.length === 1 ? (
          // Single-run case — render flush, no sub-header (matches the
          // pre-grouping visual density).
          groups[0]!.entries.map((p) => (
            <PendingChangeRow key={p.entryId} change={p} />
          ))
        ) : (
          groups.map((g) => (
            <RunGroup key={g.runId} group={g} />
          ))
        )}
      </div>
    </div>
  );
}

interface RunGroupShape {
  runId: string;
  entries: PendingChange[];
}

function groupByRun(pending: readonly PendingChange[]): RunGroupShape[] {
  const byRun = new Map<string, PendingChange[]>();
  for (const p of pending) {
    const arr = byRun.get(p.runId);
    if (arr) arr.push(p);
    else byRun.set(p.runId, [p]);
  }
  // Preserve insertion order — `pending` is already sorted by
  // createdAt asc inside the store, so the first appearance of a
  // runId is the oldest entry for that run.
  return Array.from(byRun, ([runId, entries]) => ({ runId, entries }));
}

function RunGroup({ group }: { group: RunGroupShape }) {
  const [expanded, setExpanded] = useState(true);
  const additions = group.entries.reduce((a, e) => a + e.additions, 0);
  const deletions = group.entries.reduce((a, e) => a + e.deletions, 0);
  return (
    <div className="flex flex-col border-t border-border-subtle/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="log-line app-no-drag flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-hover"
        aria-label={expanded ? 'Collapse run group' : 'Expand run group'}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-chevron)]" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-chevron)]" strokeWidth={2} />
        )}
        <div className="min-w-0 flex-1 truncate text-meta text-text-muted">
          Run {group.runId.slice(0, 8)} · {group.entries.length} change
          {group.entries.length === 1 ? '' : 's'}
        </div>
        <div className="shrink-0 text-meta text-text-faint">
          +{additions} −{deletions}
        </div>
      </button>
      {expanded && (
        <div className="flex flex-col">
          {group.entries.map((p) => (
            <PendingChangeRow key={p.entryId} change={p} />
          ))}
        </div>
      )}
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
