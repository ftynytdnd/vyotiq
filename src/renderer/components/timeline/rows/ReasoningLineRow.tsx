/**
 * ReasoningLineRow — Cascade-style single-line reasoning indicator.
 *
 * While streaming:    `Thinking…`
 * After completion:   `Thought for Ns ›`
 *
 * Expanded: shows the full reasoning body with muted italic styling,
 * consistent with how Cascade renders "Thoughts" disclosures.
 *
 * Expand behavior is "auto" and driven purely by the reasoning
 * accumulator's `done` flag from `useChatStore`:
 *   - `done === false` (streaming) → row renders expanded so live
 *     thoughts are visible as deltas arrive.
 *   - `done === true` (finished) → row renders collapsed, showing only
 *     the `Thought for Ns` summary.
 *
 * On transcript reload, historical reasoning rows arrive with `done`
 * already set and therefore render collapsed by default — older
 * conversations don't open a wall of thought blocks.
 *
 * A manual override is honored: once the user clicks the chevron, that
 * choice wins for the rest of this component instance's lifetime and
 * the auto-flip on `done` no longer fires. The override is intentionally
 * local (component state) and not persisted — switching conversations
 * and back resets to the `done`-driven default. Tool groups, file-edit
 * groups, and sub-agent rows continue to use `useTimelineUiStore` for
 * their (more useful) persisted expand state.
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useChatStore } from '../../../store/useChatStore.js';
import { DetailShell } from '../shared/DetailShell.js';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';
import { formatReasoningLabel } from '../../../lib/reasoningLabel.js';
import { SurfaceShell } from '../../ui/SurfaceShell.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName,
  timelineRowIconClassName
} from '../shared/rowStyles.js';

/**
 * Cap on the rendered reasoning body. Long chain-of-thought streams
 * routinely exceed 30+ lines and were dominating the timeline; capping
 * to ~12rem (≈ 16 lines at 12px / leading-relaxed) keeps the surface
 * present without eating the viewport. Body becomes internally
 * scrollable past this height.
 */
const REASONING_BODY_MAX_H = 'max-h-48';

/**
 * "Near bottom" tolerance for the tail-tracking heuristic. While
 * reasoning is still streaming we keep the scroll pinned to the latest
 * delta — but only if the user hasn't scrolled away. A small px-band
 * absorbs sub-pixel rounding from `scrollHeight - scrollTop -
 * clientHeight` so a casual mouse-wheel tick doesn't accidentally
 * "lose stick".
 */
const STICK_TO_BOTTOM_PX = 16;

interface ReasoningLineRowProps {
  id: string;
}

export function ReasoningLineRow({ id }: ReasoningLineRowProps) {
  const acc = useChatStore((s) => s.reasoningTexts[id]);
  // `null` = no manual interaction yet, fall back to the auto rule.
  // Once the user clicks, this becomes a concrete boolean and the
  // `acc.done` flip is ignored. Pure render-time derivation — no
  // `useEffect`, no flicker on the first delta.
  const [override, setOverride] = useState<boolean | null>(null);

  // Tail-tracking refs. `bodyRef` is the scrollable container that holds
  // the reasoning body; `stickRef` records whether the user is currently
  // pinned near the bottom and should therefore receive auto-scroll on
  // the next delta. Using a ref instead of state keeps the scroll
  // handler from triggering renders on every wheel tick.
  //
  // NOTE: all hooks must be declared before any early return. `acc` may
  // flip between undefined (no reasoning yet) and defined (streaming
  // begins) across renders; ordering these hooks after a conditional
  // return previously caused React error #310 — "Rendered more hooks
  // than during the previous render."
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const hasText = !!acc && acc.text.trim().length > 0;
  const accDone = acc?.done ?? true;
  const accText = acc?.text ?? '';

  // Derived first so the effect below can reference it unconditionally.
  // When `acc` is absent we still compute a placeholder `expanded`; the
  // component bails out before rendering any DOM that consumes it.
  const expanded = override ?? !accDone;

  useEffect(() => {
    if (!expanded || accDone) return;
    const el = bodyRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [accText, accDone, expanded]);

  if (!acc || !hasText) return null;

  // Real wall-clock stopwatch derived from the reasoning accumulator's
  // `startedAt` (set on first delta) and `endedAt` (set on reasoning-end).
  // Floors at 1 s so a near-instant turn still reads intentionally
  // instead of reporting `0s`. Shared with `SubAgentBody.ReasoningPanel`
  // through `formatReasoningLabel` so a future label rewording is a
  // one-line change rather than two.
  const { text: label, streaming } = formatReasoningLabel({
    startedAt: acc.startedAt,
    ...(acc.endedAt !== undefined ? { endedAt: acc.endedAt } : {}),
    done: acc.done
  });

  const onToggle = () => setOverride(!expanded);

  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance <= STICK_TO_BOTTOM_PX;
  };

  return (
    <SurfaceShell className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(timelineRowHeaderClassName, 'cursor-pointer')}
      >
        {expanded ? (
          <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
        ) : (
          <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
        )}
        <Brain className={cn(timelineRowIconClassName, 'text-text-faint')} strokeWidth={2} />
        <span
          className={shimmerText(
            streaming,
            cn(
              'min-w-0 flex-1 truncate text-row',
              acc.done ? 'text-text-muted' : 'text-text-secondary'
            )
          )}
          style={streaming ? shimmerStyle(`reasoning:${id}`) : undefined}
        >
          {label}
        </span>
      </button>

      {expanded && (
        <DetailShell>
          <div
            ref={bodyRef}
            onScroll={onBodyScroll}
            className={cn(
              'whitespace-pre-wrap overflow-y-auto pr-1 text-row italic leading-relaxed text-text-muted',
              REASONING_BODY_MAX_H
            )}
          >
            {acc.text}
          </div>
        </DetailShell>
      )}
    </SurfaceShell>
  );
}
