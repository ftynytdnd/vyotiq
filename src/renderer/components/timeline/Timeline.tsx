/**
 * Timeline. Pure row renderer over derived Row descriptors. All streaming
 * state (accumulators, tool previews) is maintained by the shared
 * timeline reducer in `useChatStore`. This file only renders — it does
 * NOT mirror state into any other store.
 *
 * Auto-scroll is a three-state machine:
 *   - **Prompt-to-top on send:** a brand-new `user-prompt` event arrives →
 *     smooth-scroll that prompt to the top of the viewport and re-enable
 *     sticky tail follow.
 *   - **Sticky:** while the user remains at (or near) the bottom,
 *     incoming streamed deltas keep the view pinned with smooth tail
 *     follow. Throttled via `requestAnimationFrame` so bursts of
 *     tokens don't queue dozens of scrolls.
 *   - **Unstuck:** the moment the user scrolls up more than
 *     `UNSTICK_PX`, the sticky bit drops until they scroll back within
 *     `RESTICK_PX` of the bottom or submit a new prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useFloatingLiveDiffStore } from '../../store/useFloatingLiveDiffStore.js';
import { applyDeriveRowsLiveLayer, deriveRows } from './reducer/deriveRows.js';
import { UserPromptRow } from './rows/UserPromptRow.js';
import { AskUserRow } from './rows/AskUserRow.js';
import { AssistantTextRow } from './rows/AssistantTextRow.js';
import { ReasoningLineRow } from './rows/ReasoningLineRow.js';
import { AgentThoughtRow } from './rows/AgentThoughtRow.js';
import { ErrorRow } from './rows/ErrorRow.js';
import { ToolGroupRow } from './rows/ToolGroupRow.js';
import { FileEditGroupRow } from './rows/FileEditGroupRow.js';
import { RunCompleteRow } from './rows/RunCompleteRow.js';
import { PhaseLogRow } from './rows/PhaseLogRow.js';
import type { DisplayRow } from './shared/displayRowTypes.js';
import { RowAnchor } from './shared/RowAnchor.js';
import { TimelineFindBar } from './shared/TimelineFindBar.js';
import { parseRowAnchorHash, scrollToRowAnchor } from './shared/timelineRowAnchor.js';
import { TurnBlock, groupRowsIntoTurns } from './shared/TurnBlock.js';
import { partitionTurnSegment } from './shared/groupTurnSegment.js';
import { timelineStackClassName } from './shared/rowStyles.js';
import { cn } from '../../lib/cn.js';
import { suggestProvidersForError } from '../../lib/runRecovery.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useFloatingLiveDiffAutoOpen } from './hooks/useFloatingLiveDiffAutoOpen.js';
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import { computeTailScrollKey } from './shared/computeTailScrollKey.js';
import {
  TIMELINE_SCROLL_RESTICK_PX,
  TIMELINE_SCROLL_UNSTICK_PX,
  measureTimelineScrollTail
} from './shared/scrollTailState.js';

interface TimelineProps {
  model?: ModelSelection | null;
  onOpenProviders?: () => void;
  /** Portal target for the jump-to-latest chip (above the composer footer). */
  jumpOverlayHost?: HTMLElement | null;
}

interface ErrorRowActions {
  onRetry: () => void;
  onOpenProviders?: () => void;
}

export function Timeline({ model, onOpenProviders, jumpOverlayHost: jumpOverlayHostProp }: TimelineProps) {
  // --- Stores (fixed order; never short-circuit hooks with `||`) ---
  const attachmentPreviewOpen = useAttachmentPreviewStore((s) => s.attachment !== null);
  const floatingLiveDiffOpen = useFloatingLiveDiffStore((s) => s.target !== null);
  const companionOverlayOpen = attachmentPreviewOpen || floatingLiveDiffOpen;

  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const partialToolCallArgs = useChatStore((s) => s.partialToolCallArgs);
  const settledCallIds = useChatStore((s) => s.settledCallIds);
  const liveDiffByCallId = useChatStore((s) => s.liveDiffByCallId);
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const lastUserPromptContent = useChatStore((s) => s.lastUserPromptContent);
  const lastUserPromptId = useChatStore((s) => s.lastUserPromptId);
  const send = useChatStore((s) => s.send);

  const showToast = useToastStore((s) => s.show);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);
  const setTimelineAtTail = useTimelineUiStore((s) => s.setTimelineAtTail);

  // --- Refs (all before any effect) ---
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const stickyRef = useRef(true);
  const gArmedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Local state ---
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const prevPromptIdRef = useRef<string | undefined>(undefined);

  const onRetryLastMessage = useCallback(() => {
    const prompt = lastUserPromptContent?.trim();
    if (!prompt) return;
    if (!model) {
      showToast('Select a model before retrying.', 'danger');
      return;
    }
    void send(prompt, model, permissions);
  }, [lastUserPromptContent, model, permissions, send, showToast]);

  const errorRowActions: ErrorRowActions = useMemo(
    () => ({
      onRetry: onRetryLastMessage,
      ...(onOpenProviders ? { onOpenProviders } : {})
    }),
    [onOpenProviders, onRetryLastMessage]
  );

  const applyTailState = useCallback(
    (nextSticky: boolean, scrollable: boolean, distanceFromBottom: number) => {
      if (stickyRef.current !== nextSticky) {
        stickyRef.current = nextSticky;
        setTimelineAtTail(nextSticky);
      }
      const nextShowJump =
        scrollable && distanceFromBottom > TIMELINE_SCROLL_RESTICK_PX;
      setShowJumpToLatest((prev) => (prev === nextShowJump ? prev : nextShowJump));
    },
    [setTimelineAtTail]
  );

  const syncScrollTail = useCallback(() => {
    const parent = findScrollParent(containerRef.current);
    if (!parent) return;
    const { scrollable, distanceFromBottom } = measureTimelineScrollTail(parent);
    let nextSticky = stickyRef.current;
    if (!scrollable) {
      nextSticky = true;
    } else if (stickyRef.current && distanceFromBottom > TIMELINE_SCROLL_UNSTICK_PX) {
      nextSticky = false;
    } else if (!stickyRef.current && distanceFromBottom <= TIMELINE_SCROLL_RESTICK_PX) {
      nextSticky = true;
    }
    applyTailState(nextSticky, scrollable, distanceFromBottom);
  }, [applyTailState]);

  // --- Derived rows ---
  const baseRows = useMemo(
    () =>
      deriveRows(events, {
        runActive: isProcessing,
        settledCallIds
      }),
    [events, isProcessing, settledCallIds]
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

  const turnSegments = useMemo(() => groupRowsIntoTurns(rows), [rows]);
  const lastTurnIndex = turnSegments.length - 1;

  const tailScrollKey = useMemo(
    () =>
      computeTailScrollKey(rows, assistantTexts, reasoningTexts, liveDiffByCallId),
    [rows, assistantTexts, reasoningTexts, liveDiffByCallId]
  );

  const scheduleScroll = (fn: () => void) => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      fn();
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

  // Resolve the scroll parent, sync tail state on mount / layout changes,
  // and attach a passive scroll listener.
  useEffect(() => {
    const parent = findScrollParent(containerRef.current);
    if (!parent) return;

    const onScroll = () => syncScrollTail();

    parent.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => syncScrollTail());
    ro.observe(parent);
    if (containerRef.current) ro.observe(containerRef.current);

    syncScrollTail();

    return () => {
      parent.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [companionOverlayOpen, syncScrollTail, tailScrollKey]);

  // Scroll the newest user prompt to the top of the viewport on send.
  useEffect(() => {
    const id = lastUserPromptId;
    if (!id || prevPromptIdRef.current === id) return;
    prevPromptIdRef.current = id;
    stickyRef.current = true;
    setTimelineAtTail(true);
    requestAnimationFrame(() => {
      scrollToRowAnchor(id, 'smooth');
    });
  }, [lastUserPromptId, setTimelineAtTail]);

  // Keyboard navigation between user prompts (`g j` / `g k`) and Esc to
  // drop sticky scroll. The `g`-prefix uses a short timeout so accidental
  // `j`/`k` presses don't jump.
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
          const parent = findScrollParent(containerRef.current);
          const distance = parent
            ? measureTimelineScrollTail(parent).distanceFromBottom
            : TIMELINE_SCROLL_UNSTICK_PX + 1;
          applyTailState(false, true, distance);
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
  }, [companionOverlayOpen]);

  // Sticky follow during streaming (manual_only — only when user is at tail): every time the derived row list
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
            <RowAnchor rowKey={r.key}>
              {renderRow(r, model, liveTurn, errorRowActions)}
            </RowAnchor>
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
        <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
      </div>
      {jumpOverlayHostProp &&
        showJumpToLatest &&
        events.length > 0 &&
        createPortal(
          <button
            type="button"
            onClick={() => {
              applyTailState(true, true, 0);
              scrollToTail(true);
            }}
            className="vx-jump-to-latest-chip elev-1 pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:bg-chrome-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
            aria-label="Jump to latest messages"
          >
            <ArrowDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
            <span className="vx-jump-to-latest-label">Latest</span>
          </button>,
          jumpOverlayHostProp
        )}
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
  liveTurn = false,
  errorRowActions?: ErrorRowActions
): ReactNode {
  switch (r.kind) {
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
          {...(r.mentions && r.mentions.length > 0 ? { mentions: r.mentions } : {})}
          live={liveTurn}
        />
      );
    case 'assistant-text':
      return (
        <AssistantTextRow key={r.key} id={r.id} model={model} />
      );
    case 'reasoning-line':
      return (
        <ReasoningLineRow key={r.key} id={r.id} />
      );
    case 'agent-thought':
      return (
        <AgentThoughtRow
          key={r.key}
          content={r.content}
          {...(r.severity ? { severity: r.severity } : {})}
          live={liveTurn}
        />
      );
    case 'ask-user-prompt':
      return (
        <AskUserRow
          key={r.key}
          payload={r.payload}
          displayText={r.displayText}
          promptEventId={r.id}
          toolCallId={r.toolCallId}
          runId={r.runId}
          {...(r.status ? { status: r.status } : {})}
        />
      );
    case 'error':
      return (
        <ErrorRow
          key={r.key}
          message={r.message}
          {...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {})}
          {...(r.completedAt !== undefined ? { completedAt: r.completedAt } : {})}
          {...(r.usage !== undefined ? { usage: r.usage } : {})}
          {...(r.editCount !== undefined ? { editCount: r.editCount } : {})}
          {...(r.fileCount !== undefined ? { fileCount: r.fileCount } : {})}
          onRetry={errorRowActions?.onRetry}
          {...(errorRowActions?.onOpenProviders
            ? { onOpenProviders: errorRowActions.onOpenProviders }
            : {})}
          showProviders={suggestProvidersForError(r.message)}
        />
      );
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
    case 'phase-log':
      return (
        <PhaseLogRow
          key={r.key}
          label={r.label}
          {...(r.tooltip ? { tooltip: r.tooltip } : {})}
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
