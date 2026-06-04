/**
 * Single source of truth for the reasoning-stream stopwatch label.
 *
 * The orchestrator's `ReasoningLineRow` uses this helper for
 * timeline reasoning rows: `Thinking…` while the reasoning stream is open,
 * `Thought for Ns` once the provider closes it. Previously the
 * elapsed-seconds math + label rules were copy-pasted across the two
 * call sites; consolidating here means a future reword (locale,
 * sub-second precision, etc.) is a one-line change rather than two.
 *
 * Pure / no-throw — safe to call inside a render path. Floors elapsed
 * at 1 second so a near-instant turn still reads intentionally instead
 * of reporting `0s`, matching the prior local behavior in both call
 * sites.
 */

import type { ThinkingEffort } from '@shared/types/provider.js';
import { THINKING_EFFORT_LABELS } from '@shared/providers/thinkingEffort.js';

export interface ReasoningLabelInput {
  /** Wall-clock ms when the first reasoning delta landed. */
  startedAt: number;
  /** Wall-clock ms when the reasoning stream closed. `undefined` means
   *  it's still streaming and the label tracks the live clock. */
  endedAt?: number;
  /** Mirror of the reasoning accumulator's `done` flag. Provided
   *  separately from `endedAt` so a turn that closes WITHOUT recording
   *  an end timestamp (defensive path) still flips to the past tense. */
  done: boolean;
  /** When set, appended as ` · {label}` for the effort badge. */
  effort?: ThinkingEffort;
}

export interface ReasoningLabel {
  /** Display string: `Thinking…` (live) or `Thought for Ns` (settled). */
  text: string;
  /** Elapsed seconds (rounded, floored at 1) — exposed so callers that
   *  want their own composition can reuse the value without
   *  recomputing it. */
  elapsedSeconds: number;
  /** True iff the reasoning stream is still open — convenient alias of
   *  `!done` for shimmer/streaming UI gates. */
  streaming: boolean;
}

function effortSuffix(effort: ThinkingEffort | undefined): string {
  if (effort === undefined || effort === 'off') return '';
  return ` · ${THINKING_EFFORT_LABELS[effort]}`;
}

export function formatReasoningLabel(input: ReasoningLabelInput): ReasoningLabel {
  const { startedAt, endedAt, done, effort } = input;
  const endTs = endedAt ?? Date.now();
  const elapsedSeconds = Math.max(1, Math.round((endTs - startedAt) / 1000));
  const suffix = effortSuffix(effort);
  const text = done
    ? `Thought for ${elapsedSeconds}s${suffix}`
    : `Thinking…${suffix}`;
  return { text, elapsedSeconds, streaming: !done };
}
