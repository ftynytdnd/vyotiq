/**
 * Timeline. Pure row renderer over derived Row descriptors. All streaming
 * state (accumulators, tool previews) is maintained by the shared
 * timeline reducer in `useChatStore`. This file only renders — it does
 * NOT mirror state into any other store.
 *
 * Tail scroll contract:
 *   - **Sticky:** while the user remains at (or near) the bottom,
 *     incoming streamed deltas pin the view instantly (`scrollTop`) so
 *     live agent output stays above the composer.
 *   - **User lock:** wheel/touch scroll-up releases sticky immediately;
 *     tail follow is suppressed until the user returns within
 *     `RESTICK_PX` of the bottom or taps jump-to-latest.
 *   - **Unstuck:** scrolling up past `UNSTICK_PX` drops the sticky bit.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
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
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import { computeTailScrollKey } from './shared/computeTailScrollKey.js';
import { pinScrollParentToTail } from './shared/pinScrollToTail.js';
import { findTimelineScrollParent } from './shared/timelineScrollParent.js';
import { shouldUseVirtualizedTimeline } from './shared/timelineVirtualize.js';
import { promptTurnIndices } from './shared/timelineVirtualNav.js';
import { runWithProgrammaticScrollGuard } from './shared/programmaticScrollGuard.js';
import {
  TIMELINE_SCROLL_RESTICK_PX,
  TIMELINE_SCROLL_UNSTICK_PX,
  measureTimelineScrollTail
} from './shared/scrollTailState.js';
import {
  VirtualizedTurnList,
  type TimelinePinHandle
} from './VirtualizedTurnList.js';

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
  const companionOverlayOpen = useAttachmentPreviewStore((s) => s.attachment !== null);

  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const partialToolCallArgs = useChatStore((s) => s.partialToolCallArgs);
  const settledCallIds = useChatStore((s) => s.settledCallIds);
  const liveDiffByCallId = useChatStore((s) => s.liveDiffByCallId);
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const lastUserPromptContent = useChatStore((s) => s.lastUserPromptContent);
  const send = useChatStore((s) => s.send);

  const showToast = useToastStore((s) => s.show);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);
  const setTimelineAtTail = useTimelineUiStore((s) => s.setTimelineAtTail);
  const scrollToTailRequest = useTimelineUiStore((s) => s.scrollToTailRequest);

  // --- Refs (all before any effect) ---
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pinHandleRef = useRef<TimelinePinHandle | null>(null);
  const stickyRef = useRef(true);
  /** Set when the user scrolls up; blocks tail follow until they restick. */
  const userScrollLockRef = useRef(false);
  /** Suppresses user-lock detection while we programmatically pin the tail. */
  const programmaticScrollRef = useRef(false);
  const lastScrollDistanceRef = useRef<number | null>(null);
  const gArmedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Local state ---
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [virtualized, setVirtualized] = useState(false);

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
        scrollable && distanceFromBottom > TIMELINE_SCROLL_UNSTICK_PX;
      setShowJumpToLatest((prev) => (prev === nextShowJump ? prev : nextShowJump));
    },
    [setTimelineAtTail]
  );

  const releaseUserScrollLock = useCallback(() => {
    userScrollLockRef.current = false;
  }, []);

  const engageUserScrollLock = useCallback(() => {
    userScrollLockRef.current = true;
    stickyRef.current = false;
    setTimelineAtTail(false);
  }, [setTimelineAtTail]);

  const syncScrollTail = useCallback(() => {
    const parent = findTimelineScrollParent(containerRef.current);
    if (!parent) return;
    const { scrollable, distanceFromBottom } = measureTimelineScrollTail(parent);

    if (userScrollLockRef.current) {
      if (distanceFromBottom <= TIMELINE_SCROLL_RESTICK_PX) {
        releaseUserScrollLock();
      } else {
        applyTailState(false, scrollable, distanceFromBottom);
        return;
      }
    }

    let nextSticky = stickyRef.current;
    if (!scrollable) {
      nextSticky = true;
    } else if (stickyRef.current && distanceFromBottom > TIMELINE_SCROLL_UNSTICK_PX) {
      engageUserScrollLock();
      applyTailState(false, scrollable, distanceFromBottom);
      return;
    } else if (!stickyRef.current && distanceFromBottom <= TIMELINE_SCROLL_RESTICK_PX) {
      nextSticky = true;
    }
    applyTailState(nextSticky, scrollable, distanceFromBottom);
  }, [applyTailState, engageUserScrollLock, releaseUserScrollLock]);

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

  const turnSegments = useMemo(() => groupRowsIntoTurns(rows), [rows]);
  const lastTurnIndex = turnSegments.length - 1;
  const promptTurns = useMemo(() => promptTurnIndices(turnSegments), [turnSegments]);

  useEffect(() => {
    setVirtualized((prev) => shouldUseVirtualizedTimeline(rows.length, prev));
  }, [rows.length]);

  const useVirtualizedList = virtualized && !findOpen;

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

  const scrollToTail = useCallback(
    (force: boolean) => {
      if (!force) {
        if (userScrollLockRef.current || !stickyRef.current) return;
      }
      scheduleScroll(() => {
        runWithProgrammaticScrollGuard(programmaticScrollRef, () => {
          if (useVirtualizedList && pinHandleRef.current) {
            pinHandleRef.current.pinToTail();
          } else {
            const parent = findTimelineScrollParent(containerRef.current);
            if (parent) pinScrollParentToTail(parent);
          }
        }, () => {
          const parent = findTimelineScrollParent(containerRef.current);
          if (parent) {
            lastScrollDistanceRef.current = measureTimelineScrollTail(parent).distanceFromBottom;
          }
        });
      });
    },
    [useVirtualizedList]
  );

  useEffect(() => {
    if (scrollToTailRequest === 0) return;
    releaseUserScrollLock();
    stickyRef.current = true;
    applyTailState(true, true, 0);
    scrollToTail(true);
  }, [scrollToTailRequest, applyTailState, releaseUserScrollLock, scrollToTail]);

  // Resolve the scroll parent, sync tail state on mount / layout changes,
  // and attach a passive scroll listener (stable — not re-bound per delta).
  useEffect(() => {
    const parent = findTimelineScrollParent(containerRef.current);
    if (!parent) return;

    const onScroll = () => {
      if (!programmaticScrollRef.current) {
        const { distanceFromBottom } = measureTimelineScrollTail(parent);
        const prev = lastScrollDistanceRef.current;
        if (
          prev !== null &&
          distanceFromBottom > prev + 4 &&
          distanceFromBottom > TIMELINE_SCROLL_RESTICK_PX
        ) {
          engageUserScrollLock();
        }
        lastScrollDistanceRef.current = distanceFromBottom;
      }
      syncScrollTail();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY >= -12) return;
      const { distanceFromBottom } = measureTimelineScrollTail(parent);
      if (distanceFromBottom > TIMELINE_SCROLL_UNSTICK_PX) {
        engageUserScrollLock();
      }
    };

    let touchStartY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY === null) return;
      const y = e.touches[0]?.clientY;
      if (y !== undefined && y > touchStartY) engageUserScrollLock();
    };
    const onTouchEnd = () => {
      touchStartY = null;
    };

    parent.addEventListener('scroll', onScroll, { passive: true });
    parent.addEventListener('wheel', onWheel, { passive: true });
    parent.addEventListener('touchstart', onTouchStart, { passive: true });
    parent.addEventListener('touchmove', onTouchMove, { passive: true });
    parent.addEventListener('touchend', onTouchEnd, { passive: true });

    const ro = new ResizeObserver(() => syncScrollTail());
    ro.observe(parent);
    if (containerRef.current) ro.observe(containerRef.current);

    syncScrollTail();

    return () => {
      parent.removeEventListener('scroll', onScroll);
      parent.removeEventListener('wheel', onWheel);
      parent.removeEventListener('touchstart', onTouchStart);
      parent.removeEventListener('touchmove', onTouchMove);
      parent.removeEventListener('touchend', onTouchEnd);
      ro.disconnect();
    };
  }, [companionOverlayOpen, syncScrollTail, engageUserScrollLock]);

  // Reset scroll lock on conversation switch.
  useEffect(() => {
    releaseUserScrollLock();
    stickyRef.current = true;
    setTimelineAtTail(true);
  }, [conversationId, releaseUserScrollLock, setTimelineAtTail]);

  // Keyboard navigation between user prompts (`g j` / `g k`) and Esc to
  // drop sticky scroll. The `g`-prefix uses a short timeout so accidental
  // `j`/`k` presses don't jump.
  useEffect(() => {
    const parent = findTimelineScrollParent(containerRef.current);
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

        if (promptTurns.length === 0) return;

        const parentRect = parent.getBoundingClientRect();
        const mountedPrompts = containerRef.current?.querySelectorAll(
          '[data-row-kind="user-prompt"]'
        );

        const turnIndexFromPrompt = (el: Element): number | null => {
          const host = el.closest('[data-virtual-turn-index]');
          if (!host) return null;
          const raw = host.getAttribute('data-virtual-turn-index');
          if (raw === null) return null;
          const parsed = Number.parseInt(raw, 10);
          return Number.isFinite(parsed) ? parsed : null;
        };

        let nearestListIdx = 0;
        let nearestDist = Infinity;
        mountedPrompts?.forEach((el) => {
          const turnIdx = turnIndexFromPrompt(el);
          const listIdx =
            turnIdx !== null ? promptTurns.indexOf(turnIdx) : nearestListIdx;
          if (listIdx < 0) return;
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top - parentRect.top);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestListIdx = listIdx;
          }
        });

        const dir = e.key === 'j' ? 1 : -1;
        const targetListIdx = Math.max(
          0,
          Math.min(promptTurns.length - 1, nearestListIdx + dir)
        );
        const targetTurnIdx = promptTurns[targetListIdx]!;

        const scrollPromptIntoView = (): void => {
          const prompt =
            containerRef.current?.querySelector(
              `[data-virtual-turn-index="${targetTurnIdx}"] [data-row-kind="user-prompt"]`
            ) ??
            containerRef.current?.querySelectorAll('[data-row-kind="user-prompt"]')[
              targetListIdx
            ];
          prompt?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        if (useVirtualizedList && pinHandleRef.current) {
          pinHandleRef.current.scrollToTurnIndex(targetTurnIdx);
          requestAnimationFrame(scrollPromptIntoView);
        } else {
          scrollPromptIntoView();
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
        engageUserScrollLock();
        {
          const scrollParent = findTimelineScrollParent(containerRef.current);
          const distance = scrollParent
            ? measureTimelineScrollTail(scrollParent).distanceFromBottom
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
  }, [companionOverlayOpen, applyTailState, engageUserScrollLock, promptTurns, useVirtualizedList]);

  // Sticky follow during streaming: pin when tail grows if sticky and not user-locked.
  useEffect(() => {
    scrollToTail(false);
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [tailScrollKey, scrollToTail]);

  const locationHash = typeof window !== 'undefined' ? window.location.hash : '';
  useEffect(() => {
    const scrollFromHash = () => {
      const rowKey = parseRowAnchorHash(window.location.hash);
      if (!rowKey) return;
      const reveal = (): void => {
        if (!scrollToRowAnchor(rowKey)) {
          requestAnimationFrame(reveal);
        }
      };
      if (useVirtualizedList && pinHandleRef.current) {
        pinHandleRef.current.scrollToRowKey(rowKey);
        requestAnimationFrame(reveal);
      } else {
        reveal();
      }
    };
    scrollFromHash();
    window.addEventListener('hashchange', scrollFromHash);
    return () => window.removeEventListener('hashchange', scrollFromHash);
  }, [locationHash, useVirtualizedList]);

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

  const renderTurnBlock = useCallback(
    (segment: typeof rows, segmentIndex: number) => {
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
    },
    [errorRowActions, isProcessing, lastTurnIndex, model]
  );

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
        {useVirtualizedList ? (
          <VirtualizedTurnList
            ref={pinHandleRef}
            containerRef={containerRef}
            turnSegments={turnSegments}
            tailScrollKey={tailScrollKey}
            renderTurn={renderTurnBlock}
          />
        ) : (
          turnSegments.map((segment, segmentIndex) => renderTurnBlock(segment, segmentIndex))
        )}
      </div>
      {jumpOverlayHostProp &&
        showJumpToLatest &&
        events.length > 0 &&
        createPortal(
          <button
            type="button"
            onClick={() => {
              releaseUserScrollLock();
              stickyRef.current = true;
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
          promptId={r.promptId}
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
