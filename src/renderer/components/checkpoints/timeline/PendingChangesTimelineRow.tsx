/**
 * Collapsible pending-changes row at the timeline tail.
 */

import { PendingChangesHeader } from '../pending/PendingChangesHeader.js';
import { PendingChangesList } from '../pending/PendingChangesList.js';
import { usePendingChangesTimelineRow } from './usePendingChangesTimelineRow.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../../store/useSecondaryZoneStore.js';
import { cn } from '../../../lib/cn.js';
import {
  pendingPanelEmptyClassName,
  pendingPanelListScrollClassName,
  pendingPanelShellClassName
} from '../pending/pendingPanelStyles.js';

interface PendingChangesTimelineRowProps {
  onOpenCheckpointSettings?: () => void;
}

export function PendingChangesTimelineRow({
  onOpenCheckpointSettings
}: PendingChangesTimelineRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const openCheckpoints = useSecondaryZoneStore((s) => s.openCheckpoints);
  const row = usePendingChangesTimelineRow(conversationId);

  if (!row.hasEntries) return null;

  const {
    activeWorkspaceId,
    pending,
    visiblePending,
    visibleFileCount,
    visibleAdditions,
    visibleDeletions,
    gateOn,
    runIds,
    filters,
    expanded,
    onToggleExpand,
    onAcceptAll,
    onRejectAll,
    usageLabel,
    usageTitle
  } = row;

  return (
    <>
      <div
        className={cn(pendingPanelShellClassName(gateOn), 'vyotiq-stepfade-once')}
      >
        <PendingChangesHeader
          visibleCount={visiblePending.length}
          visibleFileCount={visibleFileCount}
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
          onReviewAll={() => {
            if (conversationId && activeWorkspaceId) {
              openCheckpoints('review', { conversationId, workspaceId: activeWorkspaceId });
            }
          }}
          groupByFolder={filters.groupByFolder}
          onGroupByFolderChange={filters.setGroupByFolder}
          filtersVisible={expanded}
          embedded
          panelExpanded={expanded}
          onTogglePanel={onToggleExpand}
        />
        {expanded && (
          <div className={cn('vyotiq-expand-panel', pendingPanelListScrollClassName)}>
            {visiblePending.length === 0 ? (
              <div className={pendingPanelEmptyClassName}>
                No pending changes match the current filters.
                <button
                  type="button"
                  onClick={filters.reset}
                  className="vx-btn-text ml-2"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <PendingChangesList
                pending={visiblePending}
                groupByFolderMode={filters.groupByFolder}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
