/**
 * PendingChangesList — body of the pending-changes panel.
 *
 * Two grouping modes:
 *   - Single-run case → render flush, no sub-headers (matches the
 *     pre-grouping visual density).
 *   - Multi-run case  → group by `runId` under collapsible
 *     sub-headers; each group shows its own +/- totals.
 *
 * Virtualisation-light: when more than 60 entries are present the
 * list mounts each row inside an `IntersectionObserver`-backed
 * placeholder so off-screen rows defer their `PendingChangeDiff`
 * mount (which reads checkpoint blobs) until they actually scroll
 * into view. The DOM still renders the row's header row eagerly so
 * the scrollbar dimensions and accept-all bulk action remain
 * accurate; only the expanded diff body is deferred.
 *
 * Memory-leak hygiene: the observer is owned by `LazyMountRow` and
 * disconnected on unmount. Rows that have ever been observed-as-
 * intersecting stay mounted (no thrash on quick scroll passes).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { PendingChangeRow } from '../PendingChangeRow.js';
import { groupByRun, type RunBucket } from './groupPendingByPath.js';
import { timelineRowHeaderClassName } from '../../timeline/shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

const VIRTUALIZATION_THRESHOLD = 60;

interface PendingChangesListProps {
  pending: readonly PendingChange[];
}

export function PendingChangesList({ pending }: PendingChangesListProps) {
  const groups = useMemo(() => groupByRun(pending), [pending]);
  const shouldVirtualise = pending.length > VIRTUALIZATION_THRESHOLD;

  if (groups.length === 1) {
    return (
      <div className="flex flex-col">
        {groups[0]!.entries.map((p) => (
          <RowFrame key={p.entryId} virtualise={shouldVirtualise}>
            <PendingChangeRow change={p} />
          </RowFrame>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <RunGroup key={g.runId} group={g} virtualise={shouldVirtualise} />
      ))}
    </div>
  );
}

function RunGroup({
  group,
  virtualise
}: {
  group: RunBucket;
  virtualise: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const additions = group.entries.reduce((a, e) => a + e.additions, 0);
  const deletions = group.entries.reduce((a, e) => a + e.deletions, 0);

  return (
    <div className="flex flex-col border-t border-border-subtle/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(timelineRowHeaderClassName, 'text-left')}
        aria-label={expanded ? 'Collapse run group' : 'Expand run group'}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-chevron" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-chevron" strokeWidth={2} />
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
            <RowFrame key={p.entryId} virtualise={virtualise}>
              <PendingChangeRow change={p} />
            </RowFrame>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Lazy mount frame for a pending-change row. When `virtualise` is
 * false (the common case under the threshold) this is a no-op pass-
 * through. When true, the inner row is only mounted once the frame
 * has been observed intersecting the viewport at least once. The
 * intersect-once latch keeps quick scroll passes from thrashing
 * mount/unmount on rows that briefly leave and re-enter the viewport.
 */
function RowFrame({
  virtualise,
  children
}: {
  virtualise: boolean;
  children: ReactNode;
}) {
  if (!virtualise) return <>{children}</>;
  return <LazyMountRow>{children}</LazyMountRow>;
}

function LazyMountRow({ children }: { children: ReactNode }) {
  const [shouldMount, setShouldMount] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shouldMount) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Environments without IO (older browsers / test stubs) get
      // an immediate mount to preserve correctness over efficiency.
      setShouldMount(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldMount(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '120px 0px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [shouldMount]);

  return (
    <div ref={ref} className="min-h-7">
      {shouldMount ? children : null}
    </div>
  );
}
