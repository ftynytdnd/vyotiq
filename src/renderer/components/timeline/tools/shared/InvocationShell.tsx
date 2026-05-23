/**
 * Shared chrome for a tool invocation row. Now a flat, flush Cascade-style
 * log line in both its default and `dense` variants — no card surface.
 *
 * Layout (collapsed):
 *   [chevron] [icon]  <verb> <primary>  [status]
 *
 * Expanded: bespoke per-tool content (args, stdout, diff, matches, ...)
 * is rendered in a nested pane with a left rail of border-subtle so the
 * hierarchy stays clear without feeling boxed-in.
 *
 * Per-call durations were intentionally removed — wall-clock timing is
 * surfaced once per run via the trailing `RunCompleteRow`.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../../lib/shimmer.js';
import { StatusIcon } from './StatusIcon.js';
import { DetailShell } from '../../shared/DetailShell.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName,
  timelineRowIconClassName
} from '../../shared/rowStyles.js';
import { useChatStore } from '../../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../../store/useTimelineUiStore.js';

interface InvocationShellProps {
  Icon: LucideIcon;
  /** Leftmost label, e.g. "bash", "read", "edit". */
  title: string;
  /** One-line summary shown next to the title. Monospace when `mono` is true. */
  summary: string;
  mono?: boolean;
  /** null = pending, true = ok, false = fail. */
  ok: boolean | null;
  errorHint?: string;
  /** Expanded-detail body. Absent → row cannot expand. */
  detail?: ReactNode;
  /** Compact variant used when nested inside a sub-agent trace or group. */
  dense?: boolean;
  /**
   * Opaque key for persisting expand/collapse state via useTimelineUiStore.
   * When omitted the shell falls back to local state (non-persistent).
   * Typically the tool-call id (e.g. `inv:<callId>`).
   */
  rowKey?: string;
  /**
   * Live-streaming auto-expand flag. When true AND the user has not
   * yet manually toggled this row in the active conversation, the
   * shell renders as expanded so the bespoke detail (e.g. the
   * streaming `EditDiffView`) is visible without a click. The moment
   * the user toggles, the manual override sticks and survives the
   * partial → settled transition (the rowKey itself is stable, so
   * the override naturally carries through). When `liveAutoExpand`
   * flips back to `false` (call settled) AND no override exists, the
   * row collapses again so the transcript stays compact — mirrors
   * `ToolGroupRow`'s same-named behaviour at the parent level.
   *
   * No-op when `rowKey` is omitted (local-state path used by
   * untracked rows in tests / fixtures).
   */
  liveAutoExpand?: boolean;
}

export function InvocationShell({
  Icon,
  title,
  summary,
  mono = false,
  ok,
  errorHint,
  detail,
  dense = false,
  rowKey,
  liveAutoExpand = false
}: InvocationShellProps) {
  const canExpand = detail !== undefined && detail !== null;

  // When a rowKey is provided, use the persistent timeline UI store so
  // expand state survives re-renders, conversation switches, and restarts.
  // Fall back to local state for invocations without a stable key.
  const conversationId = useChatStore((s) => s.conversationId);
  const persistedExpanded = useTimelineUiStore((s) =>
    rowKey ? s.isExpanded(conversationId, rowKey) : false
  );
  const userOverridden = useTimelineUiStore((s) =>
    rowKey ? s.hasManualOverride(conversationId, rowKey) : false
  );
  const setExpandedPersisted = useTimelineUiStore((s) => s.setExpanded);
  const [localOpen, setLocalOpen] = useState(false);

  // Persistent path: surrender to manual override when present;
  // otherwise compose live auto-expand with the persisted slot. The
  // live signal flips off automatically once the call settles
  // (`liveAutoExpand=false`), so an un-overridden row auto-collapses
  // without any side-effect write — same pure-derivation pattern
  // `SubAgentTrace` and `ToolGroupRow` use.
  //
  // Local-state path (no rowKey): the live signal still wins so a
  // test fixture or one-off untracked row can drive the visible
  // expansion via the prop alone; toggling falls back to the local
  // `setLocalOpen` so the row remains interactive.
  const open = rowKey
    ? userOverridden
      ? persistedExpanded
      : liveAutoExpand || persistedExpanded
    : liveAutoExpand || localOpen;

  const onToggle = () => {
    if (!canExpand) return;
    if (rowKey && conversationId) {
      // Invert the visible state, NOT the persisted slot — the two
      // diverge while `liveAutoExpand` is forcing the row open before
      // the user has touched it. `setExpanded` records the override
      // and the new explicit value in one shot, mirroring
      // `ToolGroupRow`/`SubAgentTrace`.
      setExpandedPersisted(conversationId, rowKey, !open);
    } else {
      setLocalOpen((o) => !o);
    }
  };

  const iconBox = dense ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const summaryText = 'text-row';
  const padY = dense ? 'py-0.5' : 'py-1';
  const running = ok === null;

  // Dense rows collapse the `errorHint` onto the same line as the
  // summary so a long retry stack (see screenshot §4 — 7×`no match`
  // edits) doesn't double its vertical footprint. Non-dense rows keep
  // the original below-the-line treatment so top-level invocations
  // stay scannable when an error spans more than one tag.
  const inlineErrorHint = dense && errorHint && !open;

  return (
    <div className="vyotiq-stepfade flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          timelineRowHeaderClassName,
          padY,
          canExpand ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {canExpand ? (
          open ? (
            <ChevronDown className={cn(timelineRowChevronClassName, dense && 'h-3 w-3')} strokeWidth={2} />
          ) : (
            <ChevronRight className={cn(timelineRowChevronClassName, dense && 'h-3 w-3')} strokeWidth={2} />
          )
        ) : (
          <span className={cn('shrink-0', iconBox)} />
        )}
        <Icon className={cn(timelineRowIconClassName, 'text-text-faint', dense && 'h-3 w-3')} strokeWidth={2} />
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className={cn('font-medium text-text-primary', summaryText)}>{title}</span>
          <span
            className={shimmerText(
              running,
              cn(
                'min-w-0 flex-1 truncate text-text-muted',
                summaryText,
                mono && 'font-mono'
              )
            )}
            style={running ? shimmerStyle(rowKey ?? `inv:${title}:${summary}`) : undefined}
            title={summary}
          >
            {summary}
          </span>
        </div>
        {inlineErrorHint && (
          <span
            className="max-w-[14rem] shrink-0 truncate rounded-inner bg-danger-soft px-1.5 py-0.5 text-meta text-danger"
            title={errorHint}
          >
            {errorHint}
          </span>
        )}
        <StatusIcon ok={ok} size="sm" className="shrink-0" />
      </button>

      {errorHint && !open && !inlineErrorHint && (
        <div
          className={cn('ml-7 line-clamp-2 text-danger text-row')}
          title={errorHint}
        >
          {errorHint}
        </div>
      )}

      {open && canExpand && (
        <DetailShell {...(dense ? { gap: 'gap-1' } : {})}>{detail}</DetailShell>
      )}
    </div>
  );
}
