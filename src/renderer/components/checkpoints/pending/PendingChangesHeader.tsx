/**
 * PendingChangesHeader — toolbar for the pending-changes panel.
 */

import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { TextField } from '../../ui/TextField.js';
import { cn } from '../../../lib/cn.js';
import {
  chromeFilterChipClassName,
  chromeSearchRowClassName
} from '../../ui/SurfaceShell.js';
import { timelineRowChevronClassName } from '../../timeline/shared/rowStyles.js';
import {
  pendingExpandButtonClassName,
  pendingGatePillClassName,
  pendingReviewBlockPillClassName,
  pendingPanelCountChipClassName,
  pendingPanelFiltersRowClassName,
  pendingPanelHeaderClassName,
  pendingPanelMetaRowClassName,
  pendingPanelTitleButtonClassName,
  pendingPanelTitleRowClassName,
  pendingPanelToolbarRowClassName
} from './pendingPanelStyles.js';

const PATH_FILTER_AUTO_THRESHOLD = 5;

interface PendingChangesHeaderProps {
  visibleCount: number;
  visibleFileCount: number;
  totalCount: number;
  visibleAdditions: number;
  visibleDeletions: number;
  gateOn: boolean;
  reviewGateOn?: boolean;
  reviewBlocksSend?: boolean;
  runIds: readonly string[];
  selectedRunId: string | null;
  onSelectRunId: (runId: string | null) => void;
  pathQuery: string;
  onPathQueryChange: (q: string) => void;
  usageLabel: string | null;
  usageTitle: string | null;
  onOpenCheckpointSettings?: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onReviewAll?: () => void;
  groupByFolder?: boolean;
  onGroupByFolderChange?: (on: boolean) => void;
  filtersVisible?: boolean;
  embedded?: boolean;
  panelExpanded?: boolean;
  onTogglePanel?: () => void;
}

export function PendingChangesHeader({
  visibleCount,
  visibleFileCount,
  totalCount,
  visibleAdditions,
  visibleDeletions,
  gateOn,
  reviewGateOn = false,
  reviewBlocksSend = false,
  runIds,
  selectedRunId,
  onSelectRunId,
  pathQuery,
  onPathQueryChange,
  usageLabel,
  usageTitle,
  onOpenCheckpointSettings,
  onAcceptAll,
  onRejectAll,
  onReviewAll,
  groupByFolder = false,
  onGroupByFolderChange,
  filtersVisible = true,
  embedded = false,
  panelExpanded,
  onTogglePanel
}: PendingChangesHeaderProps) {
  const gateLabel = gateOn
    ? 'approve or reject before sending'
    : 'auto-accepted on next message';
  const reviewBlockLabel = 'send blocked — request changes in review';
  const filtered = visibleCount !== totalCount;
  const showFileRollup =
    visibleFileCount > 0 && visibleFileCount < visibleCount;

  const countSummary = showFileRollup
    ? `${visibleFileCount} file${visibleFileCount === 1 ? '' : 's'} · ${visibleCount} edit${visibleCount === 1 ? '' : 's'}`
    : `${visibleCount}${filtered ? ` of ${totalCount}` : ''} pending change${visibleCount === 1 ? '' : 's'}`;

  // E-phase audit: the previous `${files}/${edits}` chip (e.g. `10/23`)
  // read like a progress fraction. Explicit unit suffixes make the two
  // dimensions unmistakable while keeping the chip compact. The full
  // spelling continues to live in the `countSummary` tooltip.
  const countChip = showFileRollup
    ? `${visibleFileCount}f · ${visibleCount}e`
    : String(visibleCount);

  const collapsed = embedded && !panelExpanded;
  const expanded = embedded && panelExpanded;

  const showFilters =
    expanded &&
    filtersVisible &&
    (runIds.length > 1 ||
      totalCount >= PATH_FILTER_AUTO_THRESHOLD ||
      pathQuery.length > 0);

  const body = (
    <div
      className={cn(
        embedded && pendingPanelHeaderClassName,
        collapsed && 'gap-0.5 border-b-0 py-1'
      )}
    >
      <div className={pendingPanelTitleRowClassName}>
        {embedded && onTogglePanel && (
          <button
            type="button"
            onClick={onTogglePanel}
            aria-expanded={panelExpanded}
            aria-label={panelExpanded ? 'Collapse pending changes' : 'Expand pending changes'}
            className={pendingExpandButtonClassName}
          >
            {panelExpanded ? (
              <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
            ) : (
              <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
            )}
          </button>
        )}

        {embedded && onTogglePanel ? (
          <button
            type="button"
            onClick={onTogglePanel}
            className={pendingPanelTitleButtonClassName}
            aria-expanded={panelExpanded}
          >
            <span className="truncate text-row font-medium text-text-primary">Pending changes</span>
            <span className={pendingPanelCountChipClassName} title={countSummary}>
              {countChip}
            </span>
            {collapsed && (
              <>
                <span className={cn(pendingGatePillClassName(gateOn), 'max-w-[12rem] truncate')}>
                  {gateLabel}
                </span>
                {reviewGateOn && reviewBlocksSend && (
                  <span
                    className={cn(pendingReviewBlockPillClassName(), 'max-w-[14rem] truncate')}
                  >
                    {reviewBlockLabel}
                  </span>
                )}
              </>
            )}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-row font-medium text-text-primary">Pending changes</span>
            <span className={pendingPanelCountChipClassName} title={countSummary}>
              {countChip}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {!collapsed && onReviewAll && visibleCount >= 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReviewAll}
              aria-label="Review all changes"
              title="Review all changes one file at a time"
            >
              Review
            </Button>
          )}
          {(!collapsed || gateOn) && (
            <Button size="sm" variant="ghost" onClick={onRejectAll}>
              {collapsed ? 'Reject' : 'Reject all'}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={onAcceptAll}>
            {collapsed ? 'Accept' : 'Accept all'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className={pendingPanelToolbarRowClassName}>
          <div className={pendingPanelMetaRowClassName}>
            <span className={pendingGatePillClassName(gateOn)}>{gateLabel}</span>
            {reviewGateOn && reviewBlocksSend && (
              <span className={pendingReviewBlockPillClassName()}>{reviewBlockLabel}</span>
            )}
            {visibleCount > 0 && (visibleAdditions > 0 || visibleDeletions > 0) && (
              <span className="font-mono tabular-nums text-text-faint">
                +{visibleAdditions} −{visibleDeletions}
              </span>
            )}
            <span className="text-text-faint">{countSummary}</span>
            {usageLabel && onOpenCheckpointSettings && (
              <>
                <span className="text-text-faint/40">·</span>
                <button
                  type="button"
                  onClick={onOpenCheckpointSettings}
                  className="text-text-muted hover:text-text-primary"
                  title={usageTitle ?? 'Open checkpoint settings'}
                >
                  {usageLabel}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {collapsed && visibleCount > 0 && (visibleAdditions > 0 || visibleDeletions > 0) && (
        <div className={cn(pendingPanelToolbarRowClassName, 'pt-0')}>
          <span className="font-mono tabular-nums text-meta text-text-faint">
            +{visibleAdditions} −{visibleDeletions}
          </span>
        </div>
      )}

      {showFilters && (
        <div className={pendingPanelFiltersRowClassName}>
          {runIds.length > 1 && (
            <RunFilter
              runIds={runIds}
              selectedRunId={selectedRunId}
              onSelectRunId={onSelectRunId}
            />
          )}
          <PathFilterInput value={pathQuery} onChange={onPathQueryChange} />
          {onGroupByFolderChange && (
            <button
              type="button"
              onClick={() => onGroupByFolderChange(!groupByFolder)}
              className={chromeFilterChipClassName(groupByFolder)}
              aria-pressed={groupByFolder}
            >
              By folder
            </button>
          )}
        </div>
      )}
    </div>
  );

  return body;
}

function RunFilter({
  runIds,
  selectedRunId,
  onSelectRunId
}: {
  runIds: readonly string[];
  selectedRunId: string | null;
  onSelectRunId: (runId: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-meta">
      <span className="uppercase tracking-wider text-text-faint">Run</span>
      <button
        type="button"
        onClick={() => onSelectRunId(null)}
        className={chromeFilterChipClassName(selectedRunId === null)}
      >
        all
      </button>
      {runIds.map((runId) => (
        <button
          key={runId}
          type="button"
          onClick={() => onSelectRunId(runId)}
          title={runId}
          className={cn(
            chromeFilterChipClassName(selectedRunId === runId),
            'font-mono'
          )}
        >
          {runId.slice(0, 8)}
        </button>
      ))}
    </div>
  );
}

function PathFilterInput({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={cn(chromeSearchRowClassName, 'group/path-filter ml-auto')}>
      <Search className="h-3 w-3 text-text-faint" strokeWidth={2} />
      <TextField
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="filter by path"
        size="sm"
        tone="transparent"
        className="w-32 px-0 text-meta text-text-secondary placeholder:text-text-faint"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear path filter"
          className="text-text-faint hover:text-text-secondary"
        >
          <X className="h-3 w-3" strokeWidth={2.25} />
        </button>
      )}
    </label>
  );
}
