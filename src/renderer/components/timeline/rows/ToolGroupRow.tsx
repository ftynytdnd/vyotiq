/**
 * ToolGroupRow — the Cascade-style rolled-up line rendered for each
 * `tool-group` row emitted by `deriveRows`.
 *
 * Collapsed (default):
 *   [chevron] [tool-icon]  Read `foo.tsx` and 16 other files  [status] [duration]
 *
 * Expanded: a nested list of `ToolInvocation`s in `dense` mode. Each
 * child is independently expandable into its bespoke per-tool detail.
 * Single-child groups still wrap so the chevron + status + diff-stats
 * badge stay visible at the row level (regression-resistant: removing
 * the wrap for one-child groups breaks shimmer + diff badge layout).
 *
 * Expansion state is persisted per-conversation via `useTimelineUiStore`.
 *
 * Live-streaming auto-expand:
 *   When the group carries any `partial: true` child with a non-empty
 *   `diffStream` snapshot, the row auto-expands so the user sees the
 *   FS-aware live diff arrive without clicking. Once the user manually
 *   toggles the row, that choice persists across the partial → settled
 *   transition (manual-override surrender — same pattern
 *   `SubAgentTrace` uses for the live worker auto-expand). On settle
 *   without a manual override, the row auto-collapses again so a long
 *   multi-edit run doesn't leave the transcript pre-expanded.
 *   Mirroring the rowKey: `appendSynthesizedPartialRows` emits the
 *   same `tg:${callId}` key the settled `tool-call` branch does, so
 *   manual override survives the transition naturally.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FolderTree,
  FileText,
  PencilLine,
  Trash2,
  Search,
  Brain,
  History,
  CircleHelp,
  type LucideIcon
} from 'lucide-react';
import type { ToolName } from '@shared/types/tool.js';
import {
  toolGroupDiffStats,
  toolGroupStatus,
  toolGroupSummary,
  type ToolGroupChild
} from '../reducer/deriveRows.js';
import { StatusIcon } from '../tools/shared/StatusIcon.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { ToolInvocation } from '../tools/ToolInvocation.js';
import { DetailShell } from '../shared/DetailShell.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName,
  timelineRowIconClassName
} from '../shared/rowStyles.js';

interface ToolGroupRowProps {
  rowKey: string;
  toolName: ToolName;
  items: ToolGroupChild[];
}

const TOOL_ICONS: Record<ToolName, LucideIcon> = {
  bash: Terminal,
  ls: FolderTree,
  read: FileText,
  edit: PencilLine,
  delete: Trash2,
  search: Search,
  memory: Brain,
  recall: History,
  report: FileText,
  unknown: CircleHelp
};

export function ToolGroupRow({ rowKey, toolName, items }: ToolGroupRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const persistedExpanded = useTimelineUiStore((s) => s.isExpanded(conversationId, rowKey));
  const userOverridden = useTimelineUiStore((s) =>
    s.hasManualOverride(conversationId, rowKey)
  );
  const setExpanded = useTimelineUiStore((s) => s.setExpanded);

  const status = toolGroupStatus(items);
  const ok: boolean | null =
    status === 'running' ? null : status === 'done' ? true : false;
  const Icon = TOOL_ICONS[toolName];

  // Live-stream auto-expand. A child is "live" when its synthesised
  // `partial` flag is set AND a `diffStream` snapshot has landed —
  // either condition alone is not sufficient: a `partial` child with
  // no parsed args yet has nothing to render under the row, and a
  // `diffStream` without `partial` would mean the call already
  // settled (defensive — the reducer drops the partial entry on
  // `tool-call`). The auto-expand defers to the user's manual
  // override the moment they toggle the row, so the surrender is
  // sticky across the partial → settled transition (the rowKey is
  // stable across that flip — see `appendSynthesizedPartialRows`).
  const liveAutoExpand = items.some((c) => c.partial === true && c.diffStream != null);
  const expanded = userOverridden
    ? persistedExpanded
    : liveAutoExpand || persistedExpanded;

  const { verb, primary, suffix } = useMemo(
    () => toolGroupSummary(toolName, items),
    [toolName, items]
  );

  // Aggregate diff stats for `edit` groups, populated by the
  // `file-edit` fold in `deriveRows`. Other tools have no stats so
  // the memo returns zeros and the badge stays hidden.
  const { additions: rawAdditions, deletions: rawDeletions } = useMemo(
    () => toolGroupDiffStats(items),
    [items]
  );
  // Phase 1.6 — monotonic floor. The partial-args parser can briefly
  // omit a key while a value is mid-token (e.g. `"newString":"hel`
  // before the closing quote arrives); without a floor the badge
  // would tick down from the previously-shown count and read as the
  // model "undoing" work. Track the per-row maximum across renders
  // so a momentary parser dip is silently ignored. The floor resets
  // the moment the group transitions out of `running` — the
  // authoritative `tool-result` numbers are the source of truth
  // beyond that point.
  const peakRef = useRef<{ additions: number; deletions: number }>({
    additions: 0,
    deletions: 0
  });
  let additions = rawAdditions;
  let deletions = rawDeletions;
  if (status === 'running') {
    additions = Math.max(rawAdditions, peakRef.current.additions);
    deletions = Math.max(rawDeletions, peakRef.current.deletions);
    peakRef.current = { additions, deletions };
  } else if (peakRef.current.additions > 0 || peakRef.current.deletions > 0) {
    // Authoritative result has landed — drop the floor so a future
    // re-mount under the same key starts clean.
    peakRef.current = { additions: 0, deletions: 0 };
  }
  // Reset the peak when the rowKey identity changes (e.g. a transcript
  // switch that re-mounts the row under a different key). React's
  // ref persists across re-renders within the same instance so we
  // need an explicit hook.
  useEffect(() => {
    peakRef.current = { additions: 0, deletions: 0 };
  }, [rowKey]);
  const hasDiffStats = toolName === 'edit' && (additions > 0 || deletions > 0);
  // Edit-group is "in flight" while any child is still streaming
  // (no result yet AND no merged file-edit stats). When the live
  // stats are non-zero but the group is still mid-stream (partial
  // child), the badge shimmers; once fully settled it renders
  // statically.
  const pendingStats = hasDiffStats && status === 'running';

  const onToggle = () => {
    if (!conversationId) return;
    // Invert the VISIBLE state (`expanded`), not the persisted slot —
    // they diverge when `liveAutoExpand` opens the row before the user
    // has touched it. `setExpanded` records the override + the new
    // explicit value, mirroring `SubAgentTrace`.
    setExpanded(conversationId, rowKey, !expanded);
  };

  const running = status === 'running';

  return (
    <SurfaceShell className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={!conversationId}
        aria-expanded={expanded}
        className={cn(
          timelineRowHeaderClassName,
          conversationId ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {expanded ? (
          <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
        ) : (
          <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
        )}
        <Icon className={cn(timelineRowIconClassName, 'text-text-faint')} strokeWidth={2} />
        <div
          className={shimmerText(
            running,
            'min-w-0 flex-1 truncate text-row text-text-secondary'
          )}
          style={running ? shimmerStyle(rowKey) : undefined}
        >
          <span className="font-medium text-text-primary">{verb}</span>
          {primary && (
            <>
              {' '}
              <span className="font-mono text-text-secondary">{truncate(primary, 80)}</span>
            </>
          )}
          {suffix && (
            <span className="text-text-muted">{suffix}</span>
          )}
        </div>
        {hasDiffStats && (
          <DiffStatsBadge
            additions={additions}
            deletions={deletions}
            pending={pendingStats}
            className="shrink-0"
          />
        )}
        <StatusIcon ok={ok} size="sm" className="shrink-0" />
      </button>

      {expanded && (
        <DetailShell gap="gap-1">
          {items.map((c) => (
            <ToolInvocation
              key={c.callId}
              {...(c.call ? { call: c.call } : {})}
              {...(c.result ? { result: c.result } : {})}
              dense
              rowKey={`inv:${c.callId}`}
              {...(c.partial ? { partial: true } : {})}
              {...(c.diffStream ? { diffStream: c.diffStream } : {})}
            />
          ))}
        </DetailShell>
      )}
    </SurfaceShell>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
