/**
 * Timeline. Pure row renderer over derived Row descriptors. All streaming
 * state (accumulators, sub-agent telemetry) is maintained by the shared
 * timeline reducer in `useChatStore`. This file only renders — it does
 * NOT mirror state into any other store.
 *
 * Auto-scroll is a three-state machine:
 *   - **Center-on-send:** a brand-new `user-prompt` event arrives →
 *     smooth-scroll that prompt to the viewport center and re-enable
 *     sticky follow, even if the user was reviewing earlier turns.
 *   - **Sticky:** while the user remains at (or near) the bottom,
 *     incoming streamed deltas keep the view pinned with smooth tail
 *     follow. Throttled via `requestAnimationFrame` so bursts of
 *     tokens don't queue dozens of scrolls.
 *   - **Unstuck:** the moment the user scrolls up more than
 *     `UNSTICK_PX`, the sticky bit drops until they scroll back within
 *     `RESTICK_PX` of the bottom or submit a new prompt.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { useProviderStore, selectEffectiveContextWindow } from '../../store/useProviderStore.js';
import {
  selectEffectiveTokenBudgetWarning,
  useSettingsStore
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { applyDeriveRowsLiveLayer, deriveRows } from './reducer/deriveRows.js';
import { UserPromptRow } from './rows/UserPromptRow.js';
import { AssistantTextRow } from './rows/AssistantTextRow.js';
import { ReasoningLineRow } from './rows/ReasoningLineRow.js';
import { AgentThoughtRow } from './rows/AgentThoughtRow.js';
import { PhaseDividerRow } from './rows/PhaseDividerRow.js';
import { ErrorRow } from './rows/ErrorRow.js';
import { ToolGroupRow } from './rows/ToolGroupRow.js';
import { FileEditGroupRow } from './rows/FileEditGroupRow.js';
import { RunCompleteRow } from './rows/RunCompleteRow.js';
import { TokenBudgetWarningRow } from './rows/TokenBudgetWarningRow.js';
import { ContextSummaryRow } from './rows/ContextSummaryRow.js';
import { DelegateBatchRow } from './delegation/DelegateBatchRow.js';
import { projectSubagentRows, type DisplayRow } from './shared/projectSubagentRows.js';
import { PendingChangesTimelineRow } from '../checkpoints/timeline/index.js';
import { RowAnchor } from './shared/RowAnchor.js';
import { TimelineFindBar } from './shared/TimelineFindBar.js';
import { parseRowAnchorHash, scrollToRowAnchor } from './shared/timelineRowAnchor.js';
import { TurnBlock, groupRowsIntoTurns } from './shared/TurnBlock.js';
import { partitionTurnSegment } from './shared/groupTurnSegment.js';
import { timelineStackClassName } from './shared/rowStyles.js';
import { cn } from '../../lib/cn.js';
import { useFloatingLiveDiffAutoOpen } from './hooks/useFloatingLiveDiffAutoOpen.js';
import { computeTailScrollKey } from './shared/computeTailScrollKey.js';

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

interface TimelineProps {
  model?: ModelSelection | null;
  /** Opens Settings → Checkpoints (pending row usage pill). */
  onOpenCheckpointSettings?: () => void;
}

export function Timeline({ model, onOpenCheckpointSettings }: TimelineProps) {
  const secondaryZoneOpen = useSecondaryZoneStore((s) => s.panel !== null);
  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  // Live partial-args snapshots — pulled in so `deriveRows` can
  // synthesize in-flight tool-group rows for calls that haven't
  // yet emitted their authoritative `tool-call` event. Replays
  // and idle conversations leave this as `{}`.
  const partialToolCallArgs = useChatStore((s) => s.partialToolCallArgs);
  // Audit fix L-11 — forward the reducer-maintained settled-callId
  // map so `deriveRows` can skip its O(R×C) walk over every
  // tool-group row's children to recover the same set.
  const settledCallIds = useChatStore((s) => s.settledCallIds);
  const liveDiffByCallId = useChatStore((s) => s.liveDiffByCallId);
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
  const [findOpen, setFindOpen] = useState(false);

  /**
   * Id of the most recent `user-prompt` event. When this changes we
   * force-scroll to the tail regardless of current scroll position —
   * that is the "focus the agent" moment.
   */
  const lastUserPromptIdRef = useRef<string | null>(null);

  const summaries = useChatStore((s) => s.summaries);
  const providers = useProviderStore((s) => s.providers);
  const settings = useSettingsStore((s) => s.settings);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const contextWindow = useMemo(() => {
    if (!model) return undefined;
    return selectEffectiveContextWindow(providers, model.providerId, model.modelId);
  }, [model, providers]);

  const tokenBudgetWarnThreshold = useMemo(
    () => selectEffectiveTokenBudgetWarning(settings, activeWorkspaceId),
    [settings, activeWorkspaceId]
  );

  const baseRows = useMemo(
    () =>
      deriveRows(events, {
        runActive: isProcessing,
        settledCallIds,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        tokenBudgetWarnThreshold
      }),
    [events, isProcessing, settledCallIds, contextWindow, tokenBudgetWarnThreshold]
  );

  const rows = useMemo(
    () =>
      applyDeriveRowsLiveLayer(baseRows, {
        partialToolCallArgs,
        settledCallIds,
        liveDiffByCallId
      }),
    [baseRows, partialToolCallArgs, settledCallIds, liveDiffByCallId]
  );

  useFloatingLiveDiffAutoOpen(rows);

  const displayRows = useMemo(
    () => projectSubagentRows(rows),
    [rows]
  );

  const turnSegments = useMemo(() => groupRowsIntoTurns(displayRows), [displayRows]);
  const lastTurnIndex = turnSegments.length - 1;
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);

  const tailScrollKey = useMemo(
    () =>
      computeTailScrollKey(
        displayRows,
        assistantTexts,
        reasoningTexts,
        summaries,
        liveDiffByCallId
      ),
    [displayRows, assistantTexts, reasoningTexts, summaries, liveDiffByCallId]
  );

  // Note: a `userPromptIndices` memo lived here previously. The `g j` /
  // `g k` keyboard navigator below uses
  // `containerRef.current?.querySelectorAll('[data-row-kind="user-prompt"]')`
  // directly, so the memo's result was never read. Removed in F-004.

  const updateSticky = (next: boolean) => {
    if (stickyRef.current === next) return;
    stickyRef.current = next;
  };

  const scheduleScroll = (fn: () => void) => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      fn();
    });
  };

  const scrollNewTurnToCenter = () => {
    scheduleScroll(() => {
      const prompts = containerRef.current?.querySelectorAll('[data-row-kind="user-prompt"]');
      const last = prompts?.[prompts.length - 1];
      if (last) {
        last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  const scrollToTail = (force: boolean) => {
    if (!force && !stickyRef.current) return;
    scheduleScroll(() => {
      bottomRef.current?.scrollIntoView({
        behavior: force || stickyRef.current ? 'smooth' : 'auto',
        block: 'end'
      });
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
    };

    parent.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      parent.removeEventListener('scroll', onScroll);
    };
  }, [secondaryZoneOpen]);

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
        const active = document.activeElement;
        const inEditable =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable);
        if (inEditable) return;

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
  }, [secondaryZoneOpen]);

  // Center-on-send: whenever a brand new `user-prompt` event appears,
  // scroll that turn into the viewport center and re-enable sticky.
  // Fires exactly once per new prompt id.
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
    scrollNewTurnToCenter();
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
  }, [tailScrollKey]);

  const locationHash = typeof window !== 'undefined' ? window.location.hash : '';
  useEffect(() => {
    const scrollFromHash = () => {
      const rowKey = parseRowAnchorHash(window.location.hash);
      if (!rowKey) return;
      requestAnimationFrame(() => scrollToRowAnchor(rowKey));
    };
    scrollFromHash();
    window.addEventListener('hashchange', scrollFromHash);
    return () => window.removeEventListener('hashchange', scrollFromHash);
  }, [locationHash]);

  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      setFindOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <TimelineFindBar
        open={findOpen}
        onClose={() => setFindOpen(false)}
        rootRef={containerRef}
        contentGeneration={events.length}
      />
      <div
        ref={containerRef}
        className={cn(timelineStackClassName, 'flex flex-col')}
      >
        {turnSegments.map((segment, segmentIndex) => {
          const isLastTurn = segmentIndex === lastTurnIndex;
          const liveTurn = isProcessing && isLastTurn;
          const partitioned = partitionTurnSegment(segment);
          const segmentKey = partitioned.prompt?.key ?? `turn-${segmentIndex}`;

          const renderAnchoredRow = (r: DisplayRow) => (
            <RowAnchor rowKey={r.key}>{renderRow(r, model, liveTurn)}</RowAnchor>
          );

          return (
            <TurnBlock
              key={segmentKey}
              live={liveTurn}
              partitioned={partitioned}
              renderRow={renderAnchoredRow}
            />
          );
        })}
        <div className="relative z-0 flex flex-col gap-1">
          <PendingChangesTimelineRow
            {...(onOpenCheckpointSettings ? { onOpenCheckpointSettings } : {})}
          />
        </div>
        <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
      </div>
    </>
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

function renderRow(
  r: DisplayRow,
  model: ModelSelection | null | undefined,
  liveTurn = false
) {
  switch (r.kind) {
    case 'delegate-batch':
      return (
        <DelegateBatchRow key={r.key} rowKey={r.key} subagentIds={r.subagentIds} />
      );
    case 'user-prompt':
      return (
        <UserPromptRow
          key={r.key}
          id={r.id}
          {...(r.runId ? { runId: r.runId } : {})}
          content={r.content}
          {...(r.attachments && r.attachments.length > 0
            ? { attachments: r.attachments }
            : {})}
          live={liveTurn}
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
          {...(r.severity ? { severity: r.severity } : {})}
          live={liveTurn}
        />
      );
    case 'phase':
      return (
        <PhaseDividerRow
          key={r.key}
          label={r.label}
          {...(r.tooltip ? { tooltip: r.tooltip } : {})}
        />
      );
    case 'error':
      return <ErrorRow key={r.key} message={r.message} />;
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
    case 'token-budget-warning':
      return (
        <TokenBudgetWarningRow
          key={r.key}
          percent={r.percent}
          {...(r.tokens !== undefined ? { tokens: r.tokens } : {})}
          {...(r.ceiling !== undefined ? { ceiling: r.ceiling } : {})}
        />
      );
    case 'run-complete':
      return (
        <RunCompleteRow
          key={r.key}
          durationMs={r.durationMs}
          completedAt={r.completedAt}
          {...(r.usage !== undefined ? { usage: r.usage } : {})}
          {...(r.editCount !== undefined ? { editCount: r.editCount } : {})}
          {...(r.fileCount !== undefined ? { fileCount: r.fileCount } : {})}
        />
      );
    case 'context-summary':
      return (
        <ContextSummaryRow
          key={r.key}
          summaryId={r.summaryId}
          live={liveTurn}
        />
      );
    case 'subagent-line':
      return (
        <DelegateBatchRow
          key={r.key}
          rowKey={r.key}
          subagentIds={[r.subagentId]}
        />
      );
    default: {
      const _exhaustive: never = r;
      void _exhaustive;
      return null;
    }
  }
}

// Runtime guard lives in `reducer/runtimeGuards.ts` so non-UI callers
// (e.g. `chatChannel.ts`) can import it without pulling in the React
// tree. Import it directly from there — no re-export here.
