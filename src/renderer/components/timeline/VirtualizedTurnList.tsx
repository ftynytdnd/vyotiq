/**
 * End-anchored virtualized turn list for long transcripts.
 * Renders only visible `TurnBlock` segments; pairs with instant tail pin.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DisplayRow } from './shared/displayRowTypes.js';
import { partitionTurnSegment } from './shared/groupTurnSegment.js';
import { findTimelineScrollParent } from './shared/timelineScrollParent.js';
import { pinScrollParentToTail } from './shared/pinScrollToTail.js';

export interface TimelinePinHandle {
  pinToTail: () => void;
}

interface VirtualizedTurnListProps {
  containerRef: RefObject<HTMLDivElement | null>;
  turnSegments: DisplayRow[][];
  /** Grows during streaming — triggers remeasure of the tail turn. */
  tailScrollKey: string;
  renderTurn: (segment: DisplayRow[], segmentIndex: number) => ReactNode;
}

export const VirtualizedTurnList = forwardRef<TimelinePinHandle, VirtualizedTurnListProps>(
  function VirtualizedTurnList(
    { containerRef, turnSegments, tailScrollKey, renderTurn },
    ref
  ) {
    const scrollParentRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
      scrollParentRef.current = findTimelineScrollParent(containerRef.current);
      return () => {
        scrollParentRef.current = null;
      };
    }, [containerRef, turnSegments.length]);

    const segmentKeys = useMemo(
      () =>
        turnSegments.map((segment, index) => {
          const partitioned = partitionTurnSegment(segment);
          return partitioned.prompt?.key ?? `turn-${index}`;
        }),
      [turnSegments]
    );

    const virtualizer = useVirtualizer({
      count: turnSegments.length,
      getScrollElement: () => scrollParentRef.current,
      estimateSize: () => 180,
      overscan: 3,
      anchorTo: 'end',
      getItemKey: (index) => segmentKeys[index] ?? index,
      measureElement: (el) => el.getBoundingClientRect().height
    });

    useImperativeHandle(
      ref,
      () => ({
        pinToTail: () => {
          const parent = scrollParentRef.current;
          if (parent) pinScrollParentToTail(parent);
          if (turnSegments.length > 0) {
            virtualizer.scrollToEnd({ behavior: 'instant' });
          }
        }
      }),
      [turnSegments.length, virtualizer]
    );

    useEffect(() => {
      if (turnSegments.length === 0) return;
      const lastIndex = turnSegments.length - 1;
      const node = scrollParentRef.current
        ?.querySelector(`[data-virtual-turn-index="${lastIndex}"]`) as HTMLElement | null;
      if (node) virtualizer.measureElement(node);
    }, [tailScrollKey, turnSegments.length, virtualizer]);

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
