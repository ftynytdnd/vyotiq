/**
 * Tiny +N / -M badges used by the edit invocation and the file-edit row.
 *
 * `pending` switches the badge into a "live counter" mode used by the
 * streaming tool-call pipeline: while an `edit` is mid-stream (or its
 * `file-edit` event hasn't landed yet), the numbers tick up as the
 * model emits more `+` / `-` lines, and a shimmer cadence on the
 * numerals signals the in-flight state without adding an extra row.
 */

import { cn } from '../../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../../lib/shimmer.js';

type DiffStatsBadgeMinWidth = 'auto' | 'badge';

interface DiffStatsBadgeProps {
  additions: number;
  deletions: number;
  className?: string;
  /** When true, render the numerals with the shared shimmer cadence so
   *  the user sees the live counter tick during a streaming edit. */
  pending?: boolean;
  /** Stable token used as the shimmer animation key when `pending`.
   *  Falls back to the badge's own coordinates if not provided. */
  shimmerKey?: string;
  /**
   * Min-width / alignment hint for fixed-column layouts.
   *
   *   - `'auto'` (default) — inline-tight, follows content width.
   *     Used by the timeline `EditInvocation` / `FileEditGroupRow`
   *     headers where the badge sits at the end of a flex row.
   *   - `'badge'` — pins to `w-16 shrink-0 justify-end` so the
   *     numerals align cleanly across a vertical list of rows
   *     (`PendingChangeRow`, `RunCheckpointCard.EntryRow`,
   *     `FileHistoryList.HistoryRow`, `RevertFileRow`). Centralised
   *     here so every call site stops hand-rolling the same class
   *     string.
   */
  minWidth?: DiffStatsBadgeMinWidth;
}

export function DiffStatsBadge({
  additions,
  deletions,
  className,
  pending,
  shimmerKey,
  minWidth = 'auto'
}: DiffStatsBadgeProps) {
  const shimmer = pending === true;
  const key = shimmerKey ?? `diff:${additions}:${deletions}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        minWidth === 'badge' && 'w-16 shrink-0 justify-end',
        className
      )}
      // Announce the live count politely while streaming so a screen
      // reader user hears "+12 -3" updates without the row hijacking
      // focus. Static once the stats settle (no role/aria-live).
      {...(shimmer
        ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true }
        : {})}
    >
      {additions > 0 && (
        <span
          className={shimmerText(shimmer, 'font-mono text-row text-success')}
          style={shimmer ? shimmerStyle(`${key}:+`) : undefined}
        >
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span
          className={shimmerText(shimmer, 'font-mono text-row text-danger')}
          style={shimmer ? shimmerStyle(`${key}:-`) : undefined}
        >
          -{deletions}
        </span>
      )}
      {additions === 0 && deletions === 0 && (
        <span
          className={shimmerText(shimmer, 'font-mono text-row text-text-faint')}
          style={shimmer ? shimmerStyle(`${key}:0`) : undefined}
        >
          0
        </span>
      )}
    </span>
  );
}
