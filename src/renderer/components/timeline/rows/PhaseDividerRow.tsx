/**
 * Thin phase divider. Used by the orchestrator to announce stage
 * transitions (e.g. "Delegating 3 sub-tasks").
 *
 * Sentence-case is preserved as-emitted by the host so the divider reads
 * as a quiet inline tag instead of an all-caps banner. The earlier
 * `uppercase tracking-wider` treatment shouted at the user every time a
 * delegation round started.
 *
 * Visual structure is delegated to `TimelineDividerRow` so this row and
 * `RunCompleteRow` stay byte-identical in their hairline / spacing
 * tokens without two ad-hoc copies of the same JSX. This component
 * remains the public name `Timeline.tsx` imports.
 */

import { TimelineDividerRow } from './TimelineDividerRow.js';

interface PhaseDividerRowProps {
  label: string;
  /**
   * Optional developer-facing detail (e.g. harness contract, raw ids)
   * surfaced as a hover tooltip on the divider label. Kept out of the
   * user-facing `label` so the divider's visible copy stays clean of
   * literal `<delegate>` / `<result>` XML — see the C-phase audit fix.
   */
  tooltip?: string;
}

export function PhaseDividerRow({ label, tooltip }: PhaseDividerRowProps) {
  return (
    <div data-row-kind="phase" className="vyotiq-stepfade-once">
      <TimelineDividerRow
      label={label}
      variant="phase"
      {...(tooltip ? { tooltip } : {})}
      />
    </div>
  );
}
