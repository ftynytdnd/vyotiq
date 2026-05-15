/**
 * JumpToLatestChip — a small floating pill surfaced at the bottom of the
 * timeline when the user has scrolled away from the tail during an
 * in-flight run. Clicking it re-pins the timeline to the most recent
 * content.
 *
 * Visibility is controlled by the parent (`Timeline.tsx`), which tracks
 * the sticky/unstuck state machine and the run lifecycle. This component
 * is intentionally purely presentational so the visual language can stay
 * consistent with the rest of the stealth pill surfaces in the app
 * (empty-state hints in `ChatPage`, context pill, token pill).
 *
 * Style invariants (match existing pill family):
 *   - `bg-surface-raised` on a `rounded-full` container, elevated via
 *     the shared `.elev-1` utility (hairline inset ring + soft drop
 *     shadow) — no ad-hoc `shadow-*` + `ring-*` composition.
 *   - `text-row` label, `text-text-secondary` → `text-text-primary`
 *     on hover.
 *   - `ArrowDown` icon at `h-3 w-3`, `strokeWidth={2.25}` to match the
 *     inline lucide usage elsewhere (e.g. empty-state FolderOpen).
 *   - `sticky bottom-3` inside the timeline's flex column so it hovers
 *     just above the tail without widening the container.
 */

import { ArrowDown, ArrowUpToLine } from 'lucide-react';
import { cn } from '../../../lib/cn.js';

interface JumpToLatestChipProps {
  /**
   * Whether the chip is visible. Parent owns the predicate (usually
   * `!sticky && isProcessing`) so the chip can remain mounted — and
   * therefore transition cleanly — even when conditions flip.
   */
  visible: boolean;
  /** Re-pin handler. Parent restores `scrollIntoView` on the sentinel. */
  onClick: () => void;
  /** Scroll to the first row of the timeline. */
  onJumpToTop?: () => void;
}

export function JumpToLatestChip({ visible, onClick, onJumpToTop }: JumpToLatestChipProps) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        // `bottom-5` (was `bottom-3`) lifts the pill clear of the
        // composer's top border so it stops visually intersecting the
        // composer card (visible in screenshots §2 / §3 where the
        // pill bottom edge sat directly on the composer's top
        // border). `bottom-5` is still tight enough to read as part
        // of the timeline-tail rhythm and keeps the existing pointer
        // hit area unchanged.
        'pointer-events-none sticky bottom-5 z-10 flex justify-center gap-2',
        // The chip occupies one row in the flex column but must not push
        // layout when hidden. `-mt-8` collapses the reserved slot and
        // `h-0` + `overflow-visible` lets the button itself bleed
        // upwards out of the zero-height row.
        '-mt-8 h-0 overflow-visible'
      )}
    >
      {onJumpToTop && (
        <button
          type="button"
          onClick={onJumpToTop}
          tabIndex={visible ? 0 : -1}
          className={cn(
            'elev-1 pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1',
            'bg-surface-raised text-row text-text-secondary',
            'transition-[opacity,transform,color,background-color] duration-150 ease-out',
            'hover:bg-surface-hover hover:text-text-primary',
            visible
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-1 opacity-0'
          )}
        >
          <ArrowUpToLine className="h-3 w-3" strokeWidth={2.25} />
          <span>Top</span>
        </button>
      )}
      <button
        type="button"
        onClick={onClick}
        tabIndex={visible ? 0 : -1}
        className={cn(
          'elev-1 pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1',
          'bg-surface-raised text-row text-text-secondary',
          'transition-[opacity,transform,color,background-color] duration-150 ease-out',
          'hover:bg-surface-hover hover:text-text-primary',
          visible
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0'
        )}
      >
        <ArrowDown className="h-3 w-3" strokeWidth={2.25} />
        <span>Jump to latest</span>
      </button>
    </div>
  );
}
