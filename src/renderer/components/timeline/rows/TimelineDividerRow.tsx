/**
 * TimelineDividerRow — shared "hairline + label + hairline" row used by
 * both `PhaseDividerRow` (orchestrator phase transitions) and
 * `RunCompleteRow` (end-of-turn closer). Both surfaces want the same
 * structure (border-divider rule on each side of a faint label) but
 * with slightly different rhythm:
 *
 *   - `phase`         — a soft transition that can repeat several
 *                        times in a run, paired with `text-row`
 *                        at `py-1 gap-3`.
 *   - `run-complete`  — a louder end-of-run closer, paired with
 *                        `text-meta` at `py-2 gap-2` so the divider
 *                        breathes a little before the next run.
 *
 * Public callers continue to import `PhaseDividerRow` and
 * `RunCompleteRow` so `Timeline.tsx`'s switch-arms don't change; this
 * component is the internal de-duplication of their visual contract.
 */

import { cn } from '../../../lib/cn.js';

type TimelineDividerVariant = 'phase' | 'run-complete';

interface TimelineDividerRowProps {
  label: string;
  variant?: TimelineDividerVariant;
}

const VARIANT_CLASS: Record<
  TimelineDividerVariant,
  { wrap: string; text: string }
> = {
  phase: { wrap: 'gap-3 py-1', text: 'text-row' },
  'run-complete': { wrap: 'gap-2 py-2', text: 'text-row' }
};

export function TimelineDividerRow({
  label,
  variant = 'phase'
}: TimelineDividerRowProps) {
  const v = VARIANT_CLASS[variant];
  return (
    <div className={cn('flex items-center', v.wrap)}>
      <span className="h-px flex-1 bg-border-divider" />
      <span className={cn(v.text, 'text-text-muted')}>{label}</span>
      <span className="h-px flex-1 bg-border-divider" />
    </div>
  );
}
