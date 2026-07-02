/**
 * ContextReductionRow — collapsed audit card for a reversible-reduction pass.
 *
 * Folds a contiguous run of `tool-compacted` / `context-summary` markers into a
 * single line (`Context reduced — N offloaded · summarized · ~X chars`),
 * expandable to per-item detail. Each item is user-restorable: the full
 * offloaded body / pre-summary transcript can be fetched on demand from its
 * on-disk artifact (in addition to the agent's own `read`), so reduction is
 * transparent and reversible from the timeline. Matches the Shell Mono
 * compact-log chrome (mono meta, tabular nums, the shared collapsible header).
 */

import { memo, useCallback, useState } from 'react';
import type { ContextReductionItem } from '../reducer/deriveRows.js';
import { cn } from '../../../lib/cn.js';
import { vyotiq } from '../../../lib/ipc.js';
import { formatCompactCount } from '../../../lib/formatTokens.js';
import { useActiveConversationId } from '../../../store/useConversationsStore.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { toolTitleClassName } from '../shared/rowStyles.js';

interface ContextReductionRowProps {
  rowKey: string;
  offloadCount: number;
  summaryCount: number;
  originalChars: number;
  items: ContextReductionItem[];
}

function buildSummaryLabel(offloadCount: number, summaryCount: number): string {
  const parts: string[] = [];
  if (offloadCount > 0) {
    parts.push(`${offloadCount} item${offloadCount === 1 ? '' : 's'} offloaded`);
  }
  if (summaryCount > 0) {
    parts.push(summaryCount === 1 ? 'history summarized' : `${summaryCount} summaries`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'context trimmed';
}

export const ContextReductionRow = memo(function ContextReductionRow({
  rowKey,
  offloadCount,
  summaryCount,
  originalChars,
  items
}: ContextReductionRowProps) {
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey });
  const panelId = `context-reduction-panel-${rowKey}`;
  const summaryLabel = buildSummaryLabel(offloadCount, summaryCount);

  return (
    <div
      className="vx-timeline-activity-row vyotiq-stepfade-once flex flex-col"
      data-row-kind="context-reduction"
    >
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable
        chevronOnRight
        expandAriaLabel={expanded ? 'Collapse context reduction' : 'Expand context reduction'}
        rowAnchorKey={rowKey}
        panelId={panelId}
        trailing={
          originalChars > 0 ? (
            <span
              className="vx-caption shrink-0 font-mono tabular-nums text-text-faint"
              aria-label={`${originalChars} characters reduced`}
              title="Original content size that was offloaded/summarized (recoverable)"
            >
              ~{formatCompactCount(originalChars)} chars
            </span>
          ) : null
        }
      >
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 truncate text-row">
          <span className={toolTitleClassName(false)}>Context reduced</span>{' '}
          <span className="vx-caption text-text-faint">{summaryLabel}</span>
        </span>
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat" gap="gap-1.5">
          <div id={panelId} className="contents">
            {items.map((item) => (
              <ContextReductionItemRow key={item.id} item={item} />
            ))}
          </div>
        </DetailShell>
      )}
    </div>
  );
});

const ContextReductionItemRow = memo(function ContextReductionItemRow({
  item
}: {
  item: ContextReductionItem;
}) {
  const conversationId = useActiveConversationId();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(item.summary ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setError('No active conversation.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const reply = await vyotiq.context.readArtifact({
        conversationId,
        relativePath: item.relativePath
      });
      if (reply.ok) setContent(reply.content);
      else setError(reply.reason === 'not-found' ? 'Artifact no longer available.' : (reply.message ?? 'Could not read artifact.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId, item.relativePath]);

  const onToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    // Summary text ships inline; offloaded bodies are fetched lazily on first open.
    if (next && content === null && !loading) void load();
  }, [open, content, loading, load]);

  // For summaries the inline `summary` is the in-context block; the full
  // pre-summary transcript is what the artifact holds. Offer to fetch it too.
  const canFetchFull = item.relativePath.length > 0;

  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          className="vx-context-reduction__toggle inline-flex items-center gap-1 font-mono text-row text-text-faint transition-colors hover:text-text-secondary"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className={cn('vx-caption', open && 'text-text-secondary')}>
            {open ? '▾' : '▸'} {item.label}
          </span>
        </button>
        <span className="vx-provider-meta truncate text-text-faint/80" title={item.relativePath}>
          {item.relativePath}
        </span>
        <span className="ml-auto shrink-0 font-mono tabular-nums text-text-faint/70">
          {formatCompactCount(item.originalChars)} chars
        </span>
      </div>

      {open && (
        <div className="flex flex-col gap-1">
          {loading && <span className="vx-caption text-text-faint">Loading…</span>}
          {error && <span className="vx-caption text-danger">{error}</span>}
          {content !== null && (
            <pre className="vx-context-reduction__body max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border-subtle bg-surface-sunken p-2 font-mono text-row text-text-secondary">
              {content}
            </pre>
          )}
          {item.type === 'summary' && content !== null && content === item.summary && canFetchFull && (
            <button
              type="button"
              className="vx-context-reduction__action self-start font-mono text-row text-text-faint transition-colors hover:text-text-secondary disabled:opacity-40"
              onClick={() => void load()}
              disabled={loading}
            >
              View full pre-summary transcript
            </button>
          )}
        </div>
      )}
    </div>
  );
});
