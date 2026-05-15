/**
 * Free-form "agent thought" line (e.g. nudge telemetry emitted by the
 * orchestrator). Two visual tones:
 *
 *   - `info` (default): muted italic — blends in with `Agent V is
 *     thinking…` so cosmetic chatter doesn't draw the eye. Shimmer
 *     sweeps across the text while the run is live (`live === true`).
 *   - `warn`: amber tone with a small `AlertTriangle` glyph. Used by
 *     the orchestrator to surface retry / self-correction notices that
 *     would otherwise be visually indistinguishable from idle thinking.
 *     Warnings deliberately do NOT shimmer — they should stay visually
 *     stable so the user's attention doesn't drift.
 *
 * The severity field is cosmetic only; host logic must not treat it as a
 * privileged-content signal.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';

interface AgentThoughtRowProps {
  content: string;
  severity?: 'info' | 'warn';
  /**
   * True while the enclosing run is still streaming. Threaded from
   * `Timeline.tsx` (`isProcessing`). Toggles the info-row shimmer
   * without altering layout or copy.
   */
  live?: boolean;
  /**
   * Stable seed for the per-instance shimmer phase offset. Passed by
   * `Timeline.tsx` from the timeline event id; falls back to the
   * content string so concurrent thought rows still desync.
   */
  seed?: string;
}

export function AgentThoughtRow({
  content,
  severity = 'info',
  live = false,
  seed
}: AgentThoughtRowProps) {
  if (severity === 'warn') {
    return (
      <div className="flex items-start gap-1.5 rounded-inner px-1 py-0.5">
        <AlertTriangle
          className="mt-[3px] h-3 w-3 shrink-0 text-warning/90"
          strokeWidth={2.25}
        />
        <span className="text-log text-warning/90">{content}</span>
      </div>
    );
  }
  return (
    <div>
      <span
        className={shimmerText(live, cn('text-log italic text-text-muted'))}
        style={live ? shimmerStyle(seed ?? `thought:${content}`) : undefined}
      >
        {content}
      </span>
    </div>
  );
}
