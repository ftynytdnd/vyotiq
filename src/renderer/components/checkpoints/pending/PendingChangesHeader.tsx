/**
 * PendingChangesHeader — sticky header for the pending-changes
 * panel. Composes:
 *
 *   - Title + count + total +/- stats.
 *   - Gate label (`auto-accepted on next message` /
 *     `approve or reject before sending`).
 *   - Run filter pill — only rendered when ≥ 2 distinct runs are
 *     present.
 *   - Path filter input — substring match against `filePath`.
 *   - Workspace usage pill (clickable when `onOpenCheckpointSettings` is
 *     provided) — opens Settings → Checkpoints.
 *   - Bulk Accept / Reject buttons.
 *   - Optional `Review all` trigger that opens the lightbox mode.
 *
 * Keeps the existing surface tokens (`log-line`, `text-row`,
 * `rounded-inner`, `bg-surface-raised/60`) so the panel still reads
 * as a sibling of the timeline rather than a card-styled overlay.
 */

import { ListChecks, Search, X, GalleryHorizontal } from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { TextField } from '../../ui/TextField.js';
import { cn } from '../../../lib/cn.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../../ui/SurfaceShell.js';

/**
 * Threshold (inclusive) at which the path filter renders even when
 * there is only one run in the panel. Below this, a small list is
 * usually short enough that visual scanning beats typing — the filter
 * row stays hidden so the header doesn't feel busy.
 *
 * The previous gate required `runIds.length > 1 || pathQuery.length > 0`
 * which left the path filter permanently unreachable in single-run
 * conversations (the input was the only surface that could grow
 * `pathQuery` past zero, and the input itself was hidden by the
 * gate). Promoting the gate so it also responds to entry count fixes
 * that wiring bug without making the filter row noisy on 1-2 row
 * panels.
 */
const PATH_FILTER_AUTO_THRESHOLD = 5;

interface PendingChangesHeaderProps {
  /** Number of pending entries currently surviving the filters. */
  visibleCount: number;
  /** Total entries in the panel (pre-filter). */
  totalCount: number;
  visibleAdditions: number;
  visibleDeletions: number;
  gateOn: boolean;
  /** Distinct run ids present in the panel. */
  runIds: readonly string[];
  selectedRunId: string | null;
  onSelectRunId: (runId: string | null) => void;
  pathQuery: string;
  onPathQueryChange: (q: string) => void;
  /** Render the workspace usage pill. */
  usageLabel: string | null;
  usageTitle: string | null;
  onOpenCheckpointSettings?: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /**
   * When provided, a `Review all` trigger renders next to the
   * header's bulk buttons. The pending panel mounts the matching
   * lightbox in `PendingChangesReviewMode`.
   */
  onReviewAll?: () => void;
  /** When false, run/path filter row is hidden (timeline collapsed row). */
  filtersVisible?: boolean;
}

export function PendingChangesHeader({
  visibleCount,
  totalCount,
  visibleAdditions,
  visibleDeletions,
  gateOn,
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
  filtersVisible = true
}: PendingChangesHeaderProps) {
  const gateLabel = gateOn
    ? 'approve or reject before sending'
    : 'auto-accepted on next message';
  const showHeaderDiff = visibleCount > 1;
  const filtered = visibleCount !== totalCount;

  return (
    <SurfaceShell className={cn('flex flex-col gap-1.5', surfaceShellInnerClassName('compact'))}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
        <div className="min-w-0 flex-1 basis-52 text-row text-text-secondary">
          <span className="font-medium text-text-primary">
            {visibleCount}
            {filtered ? ` of ${totalCount}` : ''} pending change
            {totalCount === 1 ? '' : 's'}
          </span>{' '}
          <span className="text-text-muted">
            {showHeaderDiff && (
              <>
                +{visibleAdditions} −{visibleDeletions} ·{' '}
              </>
            )}
            {gateLabel}
          </span>
        </div>
        {usageLabel && onOpenCheckpointSettings && (
          <button
            type="button"
            onClick={onOpenCheckpointSettings}
            className="shrink-0 text-meta text-text-muted hover:text-text-primary"
            title={usageTitle ?? 'Open checkpoint settings'}
          >
            {usageLabel}
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onReviewAll && visibleCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReviewAll}
              aria-label="Review all changes"
              title="Review all changes one at a time"
            >
              <GalleryHorizontal className="mr-1 h-3 w-3" strokeWidth={2.25} />
              Review
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRejectAll}>
            Reject all
          </Button>
          <Button size="sm" variant="primary" onClick={onAcceptAll}>
            Accept all
          </Button>
        </div>
      </div>
      {filtersVisible &&
        (runIds.length > 1 ||
          totalCount >= PATH_FILTER_AUTO_THRESHOLD ||
          pathQuery.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {runIds.length > 1 && (
              <RunFilter
                runIds={runIds}
                selectedRunId={selectedRunId}
                onSelectRunId={onSelectRunId}
              />
            )}
            <PathFilterInput
              value={pathQuery}
              onChange={onPathQueryChange}
            />
          </div>
        )}
    </SurfaceShell>
  );
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
        className={cn(
          'rounded-inner px-1.5 py-0.5 transition-colors duration-150',
          selectedRunId === null
            ? 'bg-accent-soft/60 text-accent'
            : 'bg-surface-overlay text-text-muted hover:bg-surface-hover hover:text-text-secondary'
        )}
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
            'rounded-inner px-1.5 py-0.5 font-mono transition-colors duration-150',
            selectedRunId === runId
              ? 'bg-accent-soft/60 text-accent'
              : 'bg-surface-overlay text-text-muted hover:bg-surface-hover hover:text-text-secondary'
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
  // The outer `<label>` carries the surface + hairline border and
  // wraps the leading icon + trailing clear button. The inner
  // `TextField` uses `tone="transparent"` so it inherits the
  // wrapper's background instead of stacking its own — preserves
  // the pre-migration look while routing through the shared
  // primitive.
  return (
    <label
      className={cn(
        'group/path-filter ml-auto flex items-center gap-1 rounded-inner border border-border-subtle/40',
        'bg-surface-overlay px-2 py-0.5 text-meta',
        'focus-within:border-border-subtle focus-within:bg-surface-overlay/80'
      )}
    >
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
