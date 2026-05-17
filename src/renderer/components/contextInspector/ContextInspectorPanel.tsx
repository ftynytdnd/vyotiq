/**
 * Context Inspector slide-over.
 *
 * Visual contract: borrows the exact shell pattern from
 * `CheckpointsView` so the two surfaces feel like the same product.
 *
 *   - Same `Modal` size="lg" wrapper.
 *   - Same `flex min-h-[420px] flex-col` body.
 *   - Same `mb-3 flex items-center gap-1` tab strip with the same
 *     `app-no-drag rounded-inner px-2.5 py-1 text-row` button shape
 *     and the right-aligned `text-meta text-text-muted` summary.
 *   - Same per-tab body container — no extra cards, no shadows; the
 *     content rows themselves are the structure.
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
import { Modal } from '../ui/Modal.js';
import { Spinner } from '../ui/Spinner.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { cn } from '../../lib/cn.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { formatRatioPercent, ratioBand } from './inspectorFormat.js';
import { RulesHeader } from './RulesHeader.js';
import { MessageList } from './MessageList.js';
import { LiveStreamCard } from './LiveStreamCard.js';
import { RawDiffView } from './RawDiffView.js';
import { TriggerBar } from './TriggerBar.js';

type Tab = 'overview' | 'rules';

export function ContextInspectorPanel() {
  const isOpen = useContextSummaryStore((s) => s.isOpen);
  const close = useContextSummaryStore((s) => s.close);
  const snapshot = useContextSummaryStore((s) => s.snapshot);
  const rules = useContextSummaryStore((s) => s.rules);
  const loading = useContextSummaryStore((s) => s.loading);
  const error = useContextSummaryStore((s) => s.error);
  const mode = useContextSummaryStore((s) => s.mode);
  const refresh = useContextSummaryStore((s) => s.refresh);

  const [tab, setTab] = useState<Tab>('overview');
  // Reset to Overview each time the panel re-opens so a previous
  // session that ended on Rules doesn't surprise the user on the
  // next open.
  useEffect(() => {
    if (!isOpen) return;
    setTab('overview');
    void refresh();
  }, [isOpen, refresh]);

  const summaries = useChatStore((s) => s.summaries);
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

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={close} title="Context Inspector" size="lg">
      <div className="flex min-h-[420px] flex-col">
        {loading && !snapshot && (
          <div className="flex items-center gap-2 text-row text-text-muted">
            <Spinner size={14} />
            <span>Loading inspector…</span>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-inner bg-danger/10 px-3 py-2 text-row text-danger"
          >
            {error}
          </div>
        )}
        {snapshot && rules && (
          <>
            {/* Tab strip. Mirrors CheckpointsView exactly. */}
            <div className="mb-3 flex items-center gap-1">
              <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
                <History className="h-3.5 w-3.5" strokeWidth={2} />
                Overview
              </TabButton>
              <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>
                <SettingsIcon className="h-3.5 w-3.5" strokeWidth={2} />
                Rules
              </TabButton>
              <UsageBadge snapshot={snapshot} />
            </div>

            {tab === 'overview' && (
              <div className="flex flex-col">
                {snapshot.activeSummaryId && (
                  <LiveStreamCard summaryId={snapshot.activeSummaryId} />
                )}
                {!snapshot.activeSummaryId && latestCompletedSummaryId && (
                  <RawDiffView summaryId={latestCompletedSummaryId} />
                )}
                <div className="border-b border-border-subtle/30 py-3">
                  <MessageList
                    messages={snapshot.messages}
                    conversationId={snapshot.conversationId}
                  />
                </div>
                <TriggerBar snapshot={snapshot} rules={rules} mode={mode} />
              </div>
            )}

            {tab === 'rules' && (
              <RulesHeader
                rules={rules}
                workspaceId={
                  snapshot.workspaceId.length > 0 ? snapshot.workspaceId : null
                }
                defaultScope="workspace"
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
    </Modal>
  );
}

/**
 * Tab strip button — identical to `CheckpointsView.TabButton` so a
 * user moving between the two surfaces sees the same active /
 * inactive treatment.
 */
function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex items-center gap-1.5 rounded-inner px-2.5 py-1 text-row',
        'transition-colors duration-150',
        active
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-muted hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

/**
 * Right-aligned token-usage summary on the tab strip. Matches the
 * `CheckpointsView` "{N} runs · {N} files · {bytes}" badge tone
 * exactly so the two surfaces feel symmetrical.
 */
function UsageBadge({
  snapshot
}: {
  snapshot: import('@shared/types/contextSummary.js').ContextInspectorSnapshot;
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
        'ml-auto flex items-baseline gap-2 text-meta',
        tone
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
