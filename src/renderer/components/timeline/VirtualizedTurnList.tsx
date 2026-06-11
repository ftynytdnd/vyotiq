/**
 * End-anchored virtualized turn list for long transcripts.
 * Uses TanStack Virtual chat pattern: anchorTo end + followOnAppend.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DisplayRow } from './shared/displayRowTypes.js';
import { partitionTurnSegment } from './shared/groupTurnSegment.js';
import { findTimelineScrollParent } from './shared/timelineScrollParent.js';
import {
  TIMELINE_SCROLL_STREAM_FOLLOW_PX,
  TIMELINE_SCROLL_UNSTICK_PX
} from './shared/scrollTailState.js';
import { estimateTailTurnHeight } from './shared/timelineVirtualize.js';
import { findTurnIndexForRowKey } from './shared/timelineVirtualNav.js';

export interface TimelinePinHandle {
  pinToTail: () => void;
  scrollToTurnIndex: (index: number) => void;
  scrollToRowKey: (rowKey: string) => boolean;
  isAtEnd: () => boolean;
}

interface VirtualizedTurnListProps {
  containerRef: RefObject<HTMLDivElement | null>;
  turnSegments: DisplayRow[][];
  /** Grows during streaming — triggers remeasure of the tail turn. */
  tailScrollKey: string;
  renderTurn: (segment: DisplayRow[], segmentIndex: number) => ReactNode;
  /** Widen end-follow slack while the trailing run is still open. */
  streamFollow?: boolean;
}

export const VirtualizedTurnList = forwardRef<TimelinePinHandle, VirtualizedTurnListProps>(
  function VirtualizedTurnList(
    { containerRef, turnSegments, tailScrollKey, renderTurn, streamFollow = false },
    ref
  ) {
    const scrollParentRef = useRef<HTMLElement | null>(null);
    const [tailHeightEstimate, setTailHeightEstimate] = useState(180);

    useEffect(() => {
      scrollParentRef.current = findTimelineScrollParent(containerRef.current);
      return () => {
        scrollParentRef.current = null;
      };
    }, [containerRef, turnSegments.length]);

    useEffect(() => {
      setTailHeightEstimate(estimateTailTurnHeight(tailScrollKey));
    }, [tailScrollKey]);

    const segmentKeys = useMemo(
      () =>
        turnSegments.map((segment, index) => {
          const partitioned = partitionTurnSegment(segment);
          return partitioned.prompt?.key ?? `turn-${index}`;
        }),
      [turnSegments]
    );

    const lastIndex = turnSegments.length - 1;

    const virtualizer = useVirtualizer({
      count: turnSegments.length,
      getScrollElement: () => scrollParentRef.current,
      estimateSize: (index) =>
        index === lastIndex ? tailHeightEstimate : 180,
      overscan: 3,
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: streamFollow
        ? TIMELINE_SCROLL_STREAM_FOLLOW_PX
        : TIMELINE_SCROLL_UNSTICK_PX,
      getItemKey: (index) => segmentKeys[index] ?? index,
      measureElement: (el) => el.getBoundingClientRect().height
    });

    useImperativeHandle(
      ref,
      () => ({
        pinToTail: () => {
          if (turnSegments.length > 0) {
            virtualizer.scrollToEnd({ behavior: 'instant' });
          }
        },
        scrollToTurnIndex: (index: number) => {
          if (index < 0 || index >= turnSegments.length) return;
          virtualizer.scrollToIndex(index, { align: 'start', behavior: 'instant' });
        },
        scrollToRowKey: (rowKey: string) => {
          const index = findTurnIndexForRowKey(turnSegments, rowKey);
          if (index < 0) return false;
          virtualizer.scrollToIndex(index, { align: 'start', behavior: 'instant' });
          return true;
        },
        isAtEnd: () =>
          virtualizer.isAtEnd(
            streamFollow ? TIMELINE_SCROLL_STREAM_FOLLOW_PX : TIMELINE_SCROLL_UNSTICK_PX
          )
      }),
      [turnSegments, virtualizer]
    );

    useEffect(() => {
      if (turnSegments.length === 0) return;
      const node = scrollParentRef.current?.querySelector(
        `[data-virtual-turn-index="${lastIndex}"]`
      ) as HTMLElement | null;
      if (node) {
        virtualizer.measureElement(node);
      }
    }, [tailScrollKey, turnSegments.length, lastIndex, virtualizer, tailHeightEstimate]);

    const virtualItems = virtualizer.getVirtualItems();

    return (
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-virtual-turn-index={virtualRow.index}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderTurn(turnSegments[virtualRow.index]!, virtualRow.index)}
          </div>
        ))}
      </div>
    );
  }
);
