/**
 * Collapsible pending-changes row at the timeline tail.
 * Collapsed by default; auto-expands when gate-on is enabled.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { PendingChangesHeader } from '../pending/PendingChangesHeader.js';
import { PendingChangesList } from '../pending/PendingChangesList.js';
import { PendingChangesReviewMode } from '../pending/PendingChangesReviewMode.js';
import { usePendingChangesTimelineRow } from './usePendingChangesTimelineRow.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { timelineRowChevronClassName, timelineRowHeaderClassName } from '../../timeline/shared/rowStyles.js';

interface PendingChangesTimelineRowProps {
  /** Opens Settings → Checkpoints (usage pill). */
  onOpenCheckpointSettings?: () => void;
}

export function PendingChangesTimelineRow({
  onOpenCheckpointSettings
}: PendingChangesTimelineRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const row = usePendingChangesTimelineRow(conversationId);

  if (!row.hasEntries) return null;

  const {
    pending,
    visiblePending,
    visibleAdditions,
    visibleDeletions,
    gateOn,
    runIds,
    filters,
    expanded,
    onToggleExpand,
    reviewOpen,
    setReviewOpen,
    onAcceptAll,
    onRejectAll,
    usageLabel,
    usageTitle
  } = row;

  return (
    <>
      <SurfaceShell className={cn('flex flex-col gap-0', surfaceShellInnerClassName('compact'))}>
        <div className="flex items-start gap-0.5">
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse pending changes' : 'Expand pending changes'}
            className={cn(timelineRowHeaderClassName, 'shrink-0 rounded-inner hover:bg-surface-hover/40')}
          >
            {expanded ? (
              <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
            ) : (
              <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <PendingChangesHeader
              visibleCount={visiblePending.length}
              totalCount={pending.length}
              visibleAdditions={visibleAdditions}
              visibleDeletions={visibleDeletions}
              gateOn={gateOn}
              runIds={runIds}
              selectedRunId={filters.runId}
              onSelectRunId={filters.setRunId}
              pathQuery={filters.pathQuery}
              onPathQueryChange={filters.setPathQuery}
              usageLabel={usageLabel}
              usageTitle={usageTitle}
              {...(onOpenCheckpointSettings ? { onOpenCheckpointSettings } : {})}
              onAcceptAll={onAcceptAll}
              onRejectAll={onRejectAll}
              onReviewAll={() => setReviewOpen(true)}
              filtersVisible={expanded}
            />
          </div>
        </div>
        {expanded && (
          <div className="scrollbar-stealth ml-5 flex max-h-[min(28vh,16rem)] min-h-0 flex-col overflow-y-auto py-0.5">
            {visiblePending.length === 0 ? (
              <div className="px-3 py-4 text-row text-text-muted">
                No pending changes match the current filters.
                <button
                  type="button"
                  onClick={filters.reset}
                  className="ml-2 text-meta text-accent hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <PendingChangesList pending={visiblePending} />
            )}
          </div>
        )}
      </SurfaceShell>
      <PendingChangesReviewMode
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        entries={visiblePending}
      />
    </>
  );
}
