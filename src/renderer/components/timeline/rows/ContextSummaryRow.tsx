/**
 * Inline timeline row for a context-summarization lifecycle.
 */

import { Sparkles, Undo2 } from 'lucide-react';
import {
  chromeBadgeClassName,
  chromeRowActionClassName
} from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { shimmerText } from '../../../lib/shimmer.js';
import type { ContextSummaryAcc } from '../reducer/types.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useContextSummaryStore } from '../../../store/useContextSummaryStore.js';
import { useSecondaryZoneStore } from '../../../store/useSecondaryZoneStore.js';
import { DetailShell } from '../shared/DetailShell.js';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdownBody.js';
import { MarkdownBody } from '../markdown/MarkdownBody.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { timelineActionPillClassName, timelineLogRowClassName, timelinePhaseHeadingClassName } from '../shared/rowStyles.js';

interface ContextSummaryRowProps {
  summaryId: string;
  live?: boolean;
}

function pickBodyForPreview(acc: ContextSummaryAcc): string {
  if (acc.status === 'ended' && acc.finalText) return acc.finalText;
  return acc.text;
}

function pickHeadline(acc: ContextSummaryAcc): string {
  const count = acc.replacedMessageIds.length;
  switch (acc.status) {
    case 'pending':
    case 'streaming':
      return `Compressing ${count} message${count === 1 ? '' : 's'}…`;
    case 'ended': {
      const saved =
        typeof acc.savedPercent === 'number' && acc.savedPercent > 0
          ? `${acc.savedPercent.toFixed(1)}%`
          : '0%';
      return `Compressed ${count} message${count === 1 ? '' : 's'} (${saved} saved)`;
    }
    case 'aborted':
      return `Summarization aborted`;
  }
}

export function ContextSummaryRow({ summaryId, live = false }: ContextSummaryRowProps) {
  const acc = useChatStore((s) => s.summaries[summaryId]);
  const conversationId = useChatStore((s) => s.conversationId);
  const runId = useChatStore((s) => s.runId);
  const undo = useContextSummaryStore((s) => s.undo);
  const busy = useContextSummaryStore((s) => s.busy);
  const openInspector = useSecondaryZoneStore((s) => s.openInspector);
  const rowKey = `ctx-summary:${summaryId}`;
  const canExpand = acc?.status === 'ended' || acc?.status === 'streaming';
  const isStreamingSummary =
    acc?.status === 'pending' || acc?.status === 'streaming';
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: Boolean(canExpand && isStreamingSummary)
  });

  if (!acc) return null;

  const headline = pickHeadline(acc);
  const previewBody = pickBodyForPreview(acc);
  const isLiveHeadline =
    (live || isStreamingSummary) &&
    (acc.status === 'pending' || acc.status === 'streaming');
  const showUndoButton = acc.status === 'ended' && !acc.undone;
  const showInspectButton =
    acc.status === 'ended' &&
    (conversationId !== null || runId !== null);

  const onOpenInspector = () => {
    const id = runId ?? conversationId;
    if (!id) return;
    openInspector(id, runId ? 'live' : 'idle');
  };

  const onToggleExpand = () => {
    if (!canExpand) return;
    onToggle();
  };

  const headlineNode = (
    <span
      className={
        isLiveHeadline
          ? cn(timelinePhaseHeadingClassName(true), 'truncate')
          : shimmerText(false, 'truncate')
      }
      title={
        acc.status === 'aborted'
          ? acc.reason ?? 'Summarization failed'
          : `${acc.beforeTokens.toLocaleString()} → ${(
              acc.afterTokens ?? 0
            ).toLocaleString()} tokens`
      }
    >
      {headline}
    </span>
  );

  return (
    <div
      className={cn('vyotiq-stepfade-once flex flex-col gap-1', timelineLogRowClassName)}
      data-row-kind="context-summary"
    >
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggleExpand}
        expandable={canExpand}
        rowAnchorKey={rowKey}
      >
        {headlineNode}
      </TimelineRowHeader>
      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        {acc.undone && <span className={cn(chromeBadgeClassName, 'px-1')}>Undone</span>}
        {acc.status === 'ended' && typeof acc.afterTokens === 'number' && (
          <span className="font-mono text-meta text-text-faint">
            {acc.beforeTokens.toLocaleString()} → {acc.afterTokens.toLocaleString()} tok
          </span>
        )}
        {showInspectButton && (
          <button
            type="button"
            onClick={onOpenInspector}
            title="Open context inspector for this conversation"
            className={cn(chromeRowActionClassName, timelineActionPillClassName)}
          >
            Inspect
          </button>
        )}
        {showUndoButton && (
          <button
            type="button"
            onClick={() => {
              const targetId = runId ?? conversationId ?? undefined;
              void undo(summaryId, targetId);
            }}
            disabled={busy}
            title="Restore the messages this summary replaced. Only valid until the next user prompt."
            className={cn(
              chromeRowActionClassName,
              timelineActionPillClassName,
              'ml-auto',
              busy && 'opacity-50'
            )}
          >
            <Undo2 className="h-3 w-3" strokeWidth={2} />
            Undo
          </button>
        )}
      </div>

      {acc.status === 'streaming' && acc.reasoningText.length > 0 && (
        <div className="flex items-start gap-1 pl-6 text-meta italic text-text-faint">
          <Sparkles className="mt-[3px] h-2.5 w-2.5 shrink-0" strokeWidth={2} />
          <span className="line-clamp-2">{acc.reasoningText}</span>
        </div>
      )}
      {previewBody.length > 0 && !expanded && (
        <div className="relative pl-6">
          <div className="max-h-[3.6rem] overflow-hidden">
            {isStreamingSummary ? (
              <StreamingMarkdownBody
                text={previewBody}
                done={false}
                className="text-row text-text-muted"
              />
            ) : (
              <MarkdownBody text={previewBody} className="text-row text-text-muted" />
            )}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-surface-base via-surface-base/60 to-transparent"
          />
        </div>
      )}
      {expanded && previewBody.length > 0 && (
        <DetailShell variant="nested">
          <div className="max-h-[480px] overflow-y-auto">
            <StreamingMarkdownBody
              text={previewBody}
              done={acc.status === 'ended'}
              className="text-row text-text-secondary"
            />
          </div>
        </DetailShell>
      )}
      {acc.status === 'aborted' && acc.reason && (
        <div className="pl-6 text-meta text-danger-strong">{acc.reason}</div>
      )}
    </div>
  );
}
