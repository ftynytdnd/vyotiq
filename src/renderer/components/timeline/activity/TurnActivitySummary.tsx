/**
 * Completed-turn activity collapse — "Worked for Xs" header with
 * expandable categorized activity body. Expand state persists via
 * `useTimelineUiStore` under `turn-activity:{runId}`.
 */

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatTokenCount } from '../../../lib/formatTokens.js';
import { cn } from '../../../lib/cn.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import type { PartitionedTurn } from '../shared/groupTurnSegment.js';
import {
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_ORDER,
  groupActivityByCategory,
  resolveTurnActivityDurationMs,
  turnActivityStoreKey
} from '../shared/groupTurnSegment.js';
import { TimelineEyebrow } from '../shared/CodeLanguageEyebrow.js';
import { formatDuration } from '../rows/RunCompleteRow.js';
import {
  timelineActivityLaneClassName,
  timelineCategoryEyebrowClassName,
  timelineRowChevronClassName,
  timelineTurnInnerGapClassName
} from '../shared/rowStyles.js';

interface TurnActivitySummaryProps {
  partitioned: PartitionedTurn;
  renderRow: (row: DisplayRow) => ReactNode;
}

export function TurnActivitySummary({ partitioned, renderRow }: TurnActivitySummaryProps) {
  const { activity, footer } = partitioned;
  if (activity.length === 0) return null;

  const runComplete = footer.find((r) => r.kind === 'run-complete');
  const storeKey = turnActivityStoreKey(partitioned);
  const conversationId = useChatStore((s) => s.conversationId);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const uiKey = storeKey ? `turn-activity:${storeKey}` : null;
  const expanded = useTimelineUiStore((s) =>
    uiKey && conversationId ? s.isExpanded(conversationId, uiKey) : false
  );
  const toggle = useTimelineUiStore((s) => s.toggle);

  const durationMs = resolveTurnActivityDurationMs(partitioned, reasoningTexts);

  const stats: string[] = [];
  if (runComplete?.kind === 'run-complete') {
    if (typeof runComplete.editCount === 'number' && runComplete.editCount > 0) {
      stats.push(`${runComplete.editCount} edit${runComplete.editCount === 1 ? '' : 's'}`);
    }
    if (typeof runComplete.fileCount === 'number' && runComplete.fileCount > 0) {
      stats.push(`${runComplete.fileCount} file${runComplete.fileCount === 1 ? '' : 's'}`);
    }
    const tokenLabel =
      runComplete.usage && runComplete.usage.cumulative.totalTokens > 0
        ? formatTokenCount(runComplete.usage.cumulative.totalTokens)
        : null;
    if (tokenLabel) stats.push(`${tokenLabel} tok`);
  }

  const durationLabel = formatDuration(durationMs);
  const grouped = groupActivityByCategory(activity);
  const rowCount = activity.length;

  const onToggle = () => {
    if (!uiKey || !conversationId) return;
    toggle(conversationId, uiKey);
  };

  return (
    <div className={cn(timelineActivityLaneClassName, timelineTurnInnerGapClassName)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-row-kind="turn-activity-summary"
        className={cn(
          'app-no-drag flex w-full items-center gap-1.5 rounded-inner px-2 py-1 text-left',
          'text-meta text-text-muted transition-colors duration-150 hover:bg-surface-hover/40'
        )}
      >
        <ChevronRight
          className={cn(
            timelineRowChevronClassName,
            'transition-transform duration-150',
            expanded && 'rotate-90'
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-text-secondary">Worked for {durationLabel}</span>
          {stats.length > 0 && (
            <span className="ml-2 font-mono tabular-nums text-text-faint">
              {stats.join(' · ')}
            </span>
          )}
          {!expanded && rowCount > 0 && (
            <span className="ml-2 text-text-faint">
              · {rowCount} step{rowCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2">
          {ACTIVITY_CATEGORY_ORDER.map((category) => {
            const rows = grouped[category];
            if (rows.length === 0) return null;
            return (
              <section key={category} className="flex flex-col gap-1">
                <TimelineEyebrow
                  label={ACTIVITY_CATEGORY_LABELS[category]}
                  className={timelineCategoryEyebrowClassName}
                />
                {rows.map((row) => (
                  <div key={row.key}>{renderRow(row)}</div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
