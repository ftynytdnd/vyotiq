/**
 * Context Inspector panel for the secondary zone.
 *
 * Single-scroll accordion layout: overview sections (live stream, wire
 * breakdown, messages) plus a collapsible Rules section. The outer
 * FloatingPanel in SecondaryZone owns the panel chrome — no inner header.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Notice } from '../ui/Notice.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import {
  chromeListEmptyClassName,
  secondaryZonePanelContentClassName
} from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../lib/shellIcons.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { formatRatioPercent, ratioBand } from './inspectorFormat.js';
import { RulesHeader } from './RulesHeader.js';
import { MessageList } from './MessageList.js';
import { LiveStreamCard } from './LiveStreamCard.js';
import { RawDiffView } from './RawDiffView.js';
import { TriggerBar } from './TriggerBar.js';
import { WireBreakdown } from './WireBreakdown.js';
import type { ContextSummaryAcc } from '../timeline/reducer/types.js';

/** Stable fallback — never allocate `{}` inside a Zustand selector. */
const EMPTY_SUMMARIES: Record<string, ContextSummaryAcc> = {};

function InspectorAccordionSection({
  title,
  defaultOpen = true,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border-subtle/15 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="vx-btn vx-btn-quiet flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        ) : (
          <ChevronRight className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        )}
        <span className="vx-row-label">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

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

  useEffect(() => {
    if (!boundConversationId) return;
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
    <div className={cn('flex min-h-0 flex-1 flex-col', secondaryZonePanelContentClassName)}>
      {loading && !snapshot && (
        <div className="flex items-center gap-2 px-3 py-2 text-row text-text-muted">
          <LoadingHint message="Loading inspector…" className="py-6" size={14} />
          <span>Loading inspector…</span>
        </div>
      )}
      {error && (
        <div className="px-3 py-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {snapshot && rules && (
        <>
          <div className="shrink-0 border-b border-border-subtle/15 px-3 py-2">
            <UsageBadge snapshot={snapshot} />
          </div>
          <div className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto">
            <InspectorAccordionSection title="Overview" defaultOpen>
              {snapshot.activeSummaryId && (
                <LiveStreamCard
                  summaryId={snapshot.activeSummaryId}
                  conversationId={snapshot.conversationId}
                />
              )}
              {!snapshot.activeSummaryId && latestCompletedSummaryId && (
                <RawDiffView summaryId={latestCompletedSummaryId} />
              )}
              <MessageList messages={snapshot.messages} conversationId={snapshot.conversationId} />
            </InspectorAccordionSection>
            <InspectorAccordionSection title="Wire breakdown" defaultOpen>
              <WireBreakdown
                snapshot={snapshot}
                peakUsage={peakUsage}
                streamStartedAt={streamStartedAt}
                streamEndedAt={streamEndedAt}
              />
            </InspectorAccordionSection>
            <InspectorAccordionSection title="Rules" defaultOpen={false}>
              <RulesHeader
                rules={rules}
                workspaceId={snapshot.workspaceId.length > 0 ? snapshot.workspaceId : null}
                defaultScope="workspace"
                onOpenContextSettings={() => openContextSettings('context')}
              />
            </InspectorAccordionSection>
          </div>
          <div className="sticky bottom-0 shrink-0 border-t border-border-subtle/15 bg-surface-base/80 px-3 py-2 backdrop-blur-sm">
            <TriggerBar snapshot={snapshot} rules={rules} />
          </div>
        </>
      )}
      {!loading && !snapshot && !error && (
        <div className={chromeListEmptyClassName}>
          Couldn&apos;t read the orchestrator&apos;s context for this conversation.
        </div>
      )}
    </div>
  );
}

/** Legacy shell — delegates to body; outer zone owns panel chrome. */
export function ContextInspectorZonePanel({
  onClose: _onClose,
  embedded: _embedded = false
}: {
  onClose: () => void;
  embedded?: boolean;
}) {
  return <ContextInspectorBody />;
}

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
    <div className={cn('min-w-0 truncate vx-caption', tone)}>
      <span className="font-mono">
        {formatTokenCount(snapshot.totalTokens)}
        {typeof snapshot.ceiling === 'number' && (
          <span className="text-text-faint"> / {formatTokenCount(snapshot.ceiling)}</span>
        )}
      </span>
      <span className="font-mono"> · {ratioLabel}</span>
    </div>
  );
}
