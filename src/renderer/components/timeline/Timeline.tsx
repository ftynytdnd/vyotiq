/**
 * Timeline. Pure row renderer over derived Row descriptors. All streaming
 * state (accumulators, sub-agent telemetry) is maintained by the shared
 * timeline reducer in `useChatStore`. This file only renders — it does
 * NOT mirror state into any other store.
 *
 * Auto-scroll is a three-state machine:
 *   - **Snap:** a brand-new `user-prompt` event arrives (the user just
 *     hit Send) → unconditionally pin to the tail so the focus moves
 *     to the incoming agent response, even if the user was scrolled up
 *     reviewing earlier turns.
 *   - **Sticky:** while the user remains at (or near) the bottom,
 *     incoming streamed deltas keep the view pinned. Throttled via
 *     `requestAnimationFrame` so bursts of tokens don't queue dozens
 *     of smooth-scrolls.
 *   - **Unstuck:** the moment the user scrolls up more than
 *     `UNSTICK_PX`, the sticky bit drops. They are now in full
 *     control — no auto-scroll happens until either they scroll back
 *     within `RESTICK_PX` of the bottom, hit the "Jump to latest"
 *     chip, or submit a new prompt.
 *
 * The chip itself renders inline (sticky-positioned) and is driven
 * purely by `!sticky && isProcessing`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useChatStore } from '../../store/useChatStore.js';
import { deriveRows } from './reducer/deriveRows.js';
import { UserPromptRow } from './rows/UserPromptRow.js';
import { AssistantTextRow } from './rows/AssistantTextRow.js';
import { ReasoningLineRow } from './rows/ReasoningLineRow.js';
import { AgentThoughtRow } from './rows/AgentThoughtRow.js';
import { LiveStatusRow } from './rows/LiveStatusRow.js';
import { PhaseDividerRow } from './rows/PhaseDividerRow.js';
import { ErrorRow } from './rows/ErrorRow.js';
import { ToolGroupRow } from './rows/ToolGroupRow.js';
import { FileEditGroupRow } from './rows/FileEditGroupRow.js';
import { RunCompleteRow } from './rows/RunCompleteRow.js';
import { SubAgentTrace } from './subagent/SubAgentTrace.js';
import { JumpToLatestChip } from './shared/JumpToLatestChip.js';

/**
 * Slack (px) allowed between scroll position and the tail before the
 * sticky bit is dropped. Must comfortably exceed a single streamed
 * frame's growth so the natural "content grows under a pinned view"
 * case never looks like a user scroll.
 */
const UNSTICK_PX = 80;

/**
 * Distance (px) within which the view re-sticks after the user
 * manually scrolls back near the bottom. Kept tight so re-sticking
 * requires genuine intent (not just a wheel overshoot).
 */
const RESTICK_PX = 24;

/**
 * Threshold (px) under which the timeline is considered "at the top".
 * Hides the `Top` pill so it isn't rendered as a useless affordance
 * when the user has already scrolled to the head of the transcript.
 * Same numeric rhythm as `RESTICK_PX` — generous enough that micro-
 * scrolls don't reveal the pill, tight enough that genuine `up by
 * one row` intent flips it on.
 */
const AT_TOP_PX = 24;

interface TimelineProps {
  model?: ModelSelection | null;
}

export function Timeline({ model }: TimelineProps) {
  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  // Live partial-args snapshots — pulled in so `deriveRows` can
  // synthesize in-flight tool-group rows for calls that haven't
  // yet emitted their authoritative `tool-call` event. Replays
  // and idle conversations leave this as `{}`.
  const partialToolCallArgs = useChatStore((s) => s.partialToolCallArgs);
  // Reducer-maintained primitive that flips ONLY when a new
  // `user-prompt` event lands. Used as the snap-on-send effect's
  // sole dependency so the effect no longer fires on every streaming
  // delta and reverse-walks `events`. Audit fix §3.2.2.
  const lastUserPromptId = useChatStore((s) => s.lastUserPromptId);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);

  /**
   * Sticky flag lives in both a ref (for listeners that fire outside
   * React's commit cycle) and state (for re-rendering the chip). The
   * ref is the source of truth; `setSticky` mirrors it for the view.
   */
  const stickyRef = useRef(true);
  const [sticky, setSticky] = useState(true);

  /**
   * Mirrors `parent.scrollTop <= AT_TOP_PX` so the `Top` pill can hide
   * when the user is already near the top of the conversation. Without
   * this, the pill rendered an obviously useless "scroll to top"
   * affordance even when the user was viewing the first row of the
   * transcript (visible in screenshots §2 / §3 — `Top` button visible
   * with no rows above the viewport). Tracked in state because the
   * pill is a stateless presentational component driven by parent
   * predicates.
   */
  const [atTop, setAtTop] = useState(true);

  /**
   * Id of the most recent `user-prompt` event. When this changes we
   * force-scroll to the tail regardless of current scroll position —
   * that is the "focus the agent" moment.
   */
  const lastUserPromptIdRef = useRef<string | null>(null);

  const rows = useMemo(
    () => deriveRows(events, { runActive: isProcessing, partialToolCallArgs }),
    [events, isProcessing, partialToolCallArgs]
  );

  // Note: a `userPromptIndices` memo lived here previously. The `g j` /
  // `g k` keyboard navigator below uses
  // `containerRef.current?.querySelectorAll('[data-row-kind="user-prompt"]')`
  // directly, so the memo's result was never read. Removed in F-004.

  const updateSticky = (next: boolean) => {
    if (stickyRef.current === next) return;
    stickyRef.current = next;
    setSticky(next);
  };

  const scrollToTail = (force: boolean) => {
    if (!force && !stickyRef.current) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  };

  // Resolve the scroll parent once and attach a passive scroll listener
  // that flips the sticky bit based on distance-from-bottom. Unmount
  // cleanup releases both.
  useEffect(() => {
    const parent = findScrollParent(containerRef.current);
    if (!parent) return;

    const onScroll = () => {
      const distance = parent.scrollHeight - (parent.scrollTop + parent.clientHeight);
      if (stickyRef.current && distance > UNSTICK_PX) {
        updateSticky(false);
      } else if (!stickyRef.current && distance <= RESTICK_PX) {
        updateSticky(true);
      }
      // Recompute the at-top predicate alongside sticky so the `Top`
      // pill flips off the moment the user lands at the head — no
      // separate listener.
      const nearTop = parent.scrollTop <= AT_TOP_PX;
      setAtTop((prev) => (prev === nearTop ? prev : nearTop));
    };

    parent.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      parent.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Keyboard navigation between user prompts (`g j` / `g k`) and Esc to
  // drop sticky scroll. The `g`-prefix uses a short timeout so accidental
  // `j`/`k` presses don't jump.
  const gArmedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const parent = findScrollParent(containerRef.current);
    if (!parent) return;

    const disarm = () => {
      if (gTimerRef.current) {
        clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      }
      gArmedRef.current = false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        gArmedRef.current = true;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        gTimerRef.current = setTimeout(disarm, 600);
        return;
      }
      if (!gArmedRef.current) return;

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        disarm();

        const els = containerRef.current?.querySelectorAll('[data-row-kind="user-prompt"]');
        if (!els || els.length === 0) return;

        const parentRect = parent.getBoundingClientRect();
        // Find the prompt nearest to the current viewport top.
        let nearestIdx = 0;
        let nearestDist = Infinity;
        els.forEach((el, i) => {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top - parentRect.top);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        });

        const dir = e.key === 'j' ? 1 : -1;
        const targetIdx = Math.max(0, Math.min(els.length - 1, nearestIdx + dir));
        const target = els[targetIdx];
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        disarm();
        if (stickyRef.current) {
          updateSticky(false);
        }
        return;
      }

      // Any other key disarms the g-prefix.
      disarm();
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      disarm();
    };
  }, []);

  // Snap-on-send: whenever a brand new `user-prompt` event appears in
  // the event list, unconditionally jump to the tail and re-enable
  // sticky. This fires exactly once per new prompt id.
  //
  // Depends on `lastUserPromptId` (a reducer-maintained primitive)
  // rather than the full `events` array, so streaming deltas no
  // longer re-enter this effect and reverse-walk the transcript
  // every paint. Audit fix §3.2.2.
  useEffect(() => {
    if (!lastUserPromptId) return;
    if (lastUserPromptId === lastUserPromptIdRef.current) return;
    lastUserPromptIdRef.current = lastUserPromptId;
    updateSticky(true);
    scrollToTail(true);
  }, [lastUserPromptId]);

  // Sticky follow during streaming: every time the derived row list
  // grows we attempt to pin — but only when the sticky bit is still
  // set. The rAF throttle dedupes bursts of deltas into one paint.
  useEffect(() => {
    scrollToTail(false);
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [rows.length]);

  const onJumpToLatest = () => {
    updateSticky(true);
    scrollToTail(true);
  };

  const onJumpToTop = () => {
    const first = containerRef.current?.firstElementChild;
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2.5 py-4">
      {rows.map((r) => {
        switch (r.kind) {
          case 'user-prompt':
            return (
              <UserPromptRow
                key={r.key}
                id={r.id}
                {...(r.runId ? { runId: r.runId } : {})}
                content={r.content}
              />
            );
          case 'assistant-text':
            return <AssistantTextRow key={r.key} id={r.id} model={model} />;
          case 'reasoning-line':
            return <ReasoningLineRow key={r.key} id={r.id} />;
          case 'agent-thought':
            return (
              <AgentThoughtRow
                key={r.key}
                content={r.content}
                live={isProcessing}
                seed={r.key}
                {...(r.severity ? { severity: r.severity } : {})}
              />
            );
          case 'phase':
            return <PhaseDividerRow key={r.key} label={r.label} />;
          case 'error':
            return <ErrorRow key={r.key} message={r.message} />;
          case 'subagent-line':
            return <SubAgentTrace key={r.key} subagentId={r.subagentId} />;
          case 'tool-group':
            return (
              <ToolGroupRow
                key={r.key}
                rowKey={r.key}
                toolName={r.toolName}
                items={r.children}
              />
            );
          case 'file-edit-group':
            return (
              <FileEditGroupRow key={r.key} rowKey={r.key} items={r.children} />
            );
          case 'run-complete':
            return <RunCompleteRow key={r.key} durationMs={r.durationMs} />;
          default: {
            const _exhaustive: never = r;
            void _exhaustive;
            return null;
          }
        }
      })}
      <LiveStatusRow />
      <JumpToLatestChip
        visible={!sticky && isProcessing}
        onClick={onJumpToLatest}
        // Suppress the `Top` button when the user is already near the
        // top of the transcript — rendering it there is a useless
        // affordance (visible in screenshots §2 / §3). The `Jump to
        // latest` button still shows because the user IS scrolled
        // away from the tail by definition (`!sticky`).
        {...(atTop ? {} : { onJumpToTop })}
      />
      <div ref={bottomRef} />
    </div>
  );
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return cur;
    cur = cur.parentElement;
  }
  return null;
}

// Runtime guard lives in `reducer/runtimeGuards.ts` so non-UI callers
// (e.g. `chatChannel.ts`) can import it without pulling in the React
// tree. Import it directly from there — no re-export here.
