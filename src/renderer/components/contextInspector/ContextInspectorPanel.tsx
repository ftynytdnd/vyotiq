/**
 * Context Inspector panel for the secondary zone.
 *
 * Visual contract: borrows the same shell pattern as
 * `CheckpointsView` — `PanelFrame` in the secondary zone, dock-style
 * tab strip, flat rows (no modal backdrop). Message rows and summary
 * cards use nested `SurfaceShell` panels matching the timeline.
 *
 * Two tabs:
 *   - **Overview** — message list + manual trigger + (when present)
 *     the live-stream card and the most-recent-summary tabbed view.
 *     The user spends 95 % of their time here.
 *   - **Rules**    — the flat `RulesHeader` form, scoped to the
 *     active workspace by default. Settings → Context handles the
 *     global scope.
 *
 * The header summary line on the right of the tab strip mirrors
 * `CheckpointsView`'s usage badge:
 *
 *     "{used} / {ceiling} tokens · {pct}% of context window"
 *
 * Same typographic hierarchy, same alignment, same monospace tone
 * for the numbers.
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Settings as SettingsIcon } from 'lucide-react';
import { PanelFrame } from '../zone/PanelFrame.js';
import { Notice } from '../ui/Notice.js';
import { Spinner } from '../ui/Spinner.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { chromeEdgeClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { formatRatioPercent, ratioBand } from './inspectorFormat.js';
import { RulesHeader } from './RulesHeader.js';
import { MessageList } from './MessageList.js';
import { LiveStreamCard } from './LiveStreamCard.js';
import { RawDiffView } from './RawDiffView.js';
import { TriggerBar } from './TriggerBar.js';
import { WireBreakdown } from './WireBreakdown.js';
import type { ContextSummaryAcc } from '../timeline/reducer/types.js';

type Tab = 'overview' | 'rules';

/** Stable fallback — never allocate `{}` inside a Zustand selector. */
const EMPTY_SUMMARIES: Record<string, ContextSummaryAcc> = {};

/**
 * Tab catalogue for the Inspector strip. Lifted to module scope so
 * the `Tabs` primitive's child identity stays stable across renders
 * — re-rendering for a different reason (snapshot refresh, etc.)
 * won't reset the strip's internal focus tracking.
 */
const INSPECTOR_TABS: TabItem<Tab>[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <History className="h-3.5 w-3.5" strokeWidth={2} />
  },
  {
    id: 'rules',
    label: 'Rules',
    icon: <SettingsIcon className="h-3.5 w-3.5" strokeWidth={2} />
  }
];

/** Inspector body for the secondary zone or modal shell. */
export function ContextInspectorBody() {
  const snapshot = useContextSummaryStore((s) => s.snapshot);
  const rules = useContextSummaryStore((s) => s.rules);
  const openContextSettings = useSecondaryZoneStore((s) => s.openSettings);
  const loading = useContextSummaryStore((s) => s.loading);
  const error = useContextSummaryStore((s) => s.error);
  const boundConversationId = snapshot?.conversationId;
  const peakUsage = useChatStore((s) =>
    boundConversationId ? s.slices[boundConversationId]?.orchestratorUsage?.peak : undefined
  );
  const streamStartedAt = useChatStore((s) =>
    boundConversationId
      ? s.slices[boundConversationId]?.orchestratorUsage?.streamStartedAt
      : undefined
  );
  const streamEndedAt = useChatStore((s) =>
    boundConversationId
      ? s.slices[boundConversationId]?.orchestratorUsage?.streamEndedAt
      : undefined
  );

  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    if (!boundConversationId) return;
    setTab('overview');
    void useContextSummaryStore.getState().refresh();
  }, [boundConversationId]);

  const summaries = useChatStore((s) => {
    if (!boundConversationId) return EMPTY_SUMMARIES;
    return s.slices[boundConversationId]?.summaries ?? EMPTY_SUMMARIES;
  });
  const latestCompletedSummaryId = useMemo(() => {
    let candidate: string | null = null;
    let candidateAt = 0;
    for (const id in summaries) {
      const acc = summaries[id]!;
      if (acc.status !== 'ended' && acc.status !== 'aborted') continue;
      if (acc.startedAt >= candidateAt) {
        candidate = id;
        candidateAt = acc.startedAt;
      }
    }
    return candidate;
  }, [summaries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && !snapshot && (
        <div className="flex items-center gap-2 text-row text-text-muted">
          <Spinner size={14} />
          <span>Loading inspector…</span>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {snapshot && rules && (
        <>
          <div className="mb-3 flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1">
            <Tabs<Tab>
              items={INSPECTOR_TABS}
              value={tab}
              onChange={setTab}
              variant="strip"
              ariaLabel="Context inspector view"
            />
            <UsageBadge snapshot={snapshot} className="sm:ml-auto" />
          </div>

          {tab === 'overview' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                {snapshot.activeSummaryId && (
                  <LiveStreamCard
                    summaryId={snapshot.activeSummaryId}
                    conversationId={snapshot.conversationId}
                  />
                )}
                {!snapshot.activeSummaryId && latestCompletedSummaryId && (
                  <RawDiffView summaryId={latestCompletedSummaryId} />
                )}
                <WireBreakdown
                  snapshot={snapshot}
                  peakUsage={peakUsage}
                  streamStartedAt={streamStartedAt}
                  streamEndedAt={streamEndedAt}
                />
                <MessageList
                  messages={snapshot.messages}
                  conversationId={snapshot.conversationId}
                />
              </div>
              <div
                className={cn(
                  'sticky bottom-0 shrink-0 border-t bg-surface-base/80 px-3 py-2 backdrop-blur-sm',
                  chromeEdgeClassName
                )}
              >
                <TriggerBar snapshot={snapshot} rules={rules} />
              </div>
            </div>
          )}

          {tab === 'rules' && (
            <RulesHeader
              rules={rules}
              workspaceId={
                snapshot.workspaceId.length > 0 ? snapshot.workspaceId : null
              }
              defaultScope="workspace"
              onOpenContextSettings={() => openContextSettings('context')}
            />
          )}
        </>
      )}
      {!loading && !snapshot && !error && (
        <div className="text-row text-text-muted">
          Couldn't read the orchestrator's context for this conversation.
        </div>
      )}
    </div>
  );
}

/** Embedded inspector shell for the secondary zone. */
export function ContextInspectorZonePanel({
  onClose,
  embedded: _embedded = false
}: {
  onClose: () => void;
  embedded?: boolean;
}) {
  return (
    <PanelFrame
      title="Context Inspector"
      onClose={onClose}
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className="h-full"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        <ContextInspectorBody />
      </div>
    </PanelFrame>
  );
}

/**
 * Right-aligned token-usage summary on the tab strip. Matches the
 * `CheckpointsView` "{N} runs · {N} files · {bytes}" badge tone
 * exactly so the two surfaces feel symmetrical.
 */
function UsageBadge({
  snapshot,
  className
}: {
  snapshot: import('@shared/types/contextSummary.js').ContextInspectorSnapshot;
  className?: string;
}) {
  const band = ratioBand(snapshot.currentRatio);
  const ratioLabel = formatRatioPercent(snapshot.currentRatio);
  const tone =
    band === 'danger'
      ? 'text-danger'
      : band === 'warn'
        ? 'text-warning'
        : 'text-text-muted';
  return (
    <div
      className={cn(
        'flex min-w-0 items-baseline gap-2 truncate text-meta',
        tone,
        className
      )}
    >
      <span className="font-mono">
        {formatTokenCount(snapshot.totalTokens)}
        {typeof snapshot.ceiling === 'number' && (
          <span className="text-text-faint"> / {formatTokenCount(snapshot.ceiling)}</span>
        )}
      </span>
      <span className="font-mono">{ratioLabel}</span>
      <span className="text-text-faint">
        {snapshot.messages.length} message{snapshot.messages.length === 1 ? '' : 's'}
      </span>
    </div>
  );
}
