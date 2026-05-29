/**
 * TimelineDividerRow — shared centered label row used by
 * `RunCompleteRow` (end-of-turn closer). Phase dividers are no longer
 * rendered in the timeline.
 *
 * Visual contract (May 2026 restyle): a single quiet centered label,
 * no horizontal hairline rules on either side. The earlier
 * "hairline + label + hairline" interstitial added two horizontal
 * rules per phase event and one above every run-complete row;
 * collectively they fragmented the reading column. Both surfaces
 * now read as plain log lines that breathe via vertical rhythm only.
 *
 *   - `phase`         — soft transition; `text-row` at `py-1`.
 *   - `run-complete`  — louder end-of-run closer; `text-row` at `py-2`
 *                       so the divider breathes a little more before
 *                       the next turn block.
 *
 * Public callers continue to import `RunCompleteRow` so `Timeline.tsx`'s
 * switch-arms don't change.
 */

import { cn } from '../../../lib/cn.js';
import { isPhaseHeadlineLabel, timelinePhaseHeadingClassName } from '../shared/rowStyles.js';

type TimelineDividerVariant = 'phase' | 'run-complete';

interface TimelineDividerRowProps {
  label: string;
  variant?: TimelineDividerVariant;
  /**
   * Optional hover tooltip surfaced via the label span's native `title`
   * attribute. Used by phase dividers to carry developer-facing detail
   * (raw `<delegate>` / `<result>` contract, full reason text) without
   * polluting the user-facing `label`. `cursor-help` is applied so the
   * hint affordance is discoverable.
   */
  tooltip?: string;
}

const VARIANT_WRAP: Record<TimelineDividerVariant, string> = {
  phase: 'py-1',
  'run-complete': 'vx-timeline-divider-run-complete'
};

export function TimelineDividerRow({
  label,
  variant = 'phase',
  tooltip
}: TimelineDividerRowProps) {
  const wrap = VARIANT_WRAP[variant];
  const goldHeadline = variant === 'phase' && isPhaseHeadlineLabel(label);
  return (
    <div className={cn('flex items-center justify-center', wrap)}>
      <span
        className={cn(
          'vx-timeline-divider',
          goldHeadline ? timelinePhaseHeadingClassName() : 'vx-caption',
          tooltip && 'cursor-help'
        )}
        {...(tooltip ? { title: tooltip } : {})}
      >
        {label}
      </span>
    </div>
  );
}
