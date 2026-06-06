/**
 * VirtualizedTurnList — mounts at threshold with end-anchored virtualizer config.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import type { DisplayRow } from '@renderer/components/timeline/shared/displayRowTypes.js';
import {
  VirtualizedTurnList,
  type TimelinePinHandle
} from '@renderer/components/timeline/VirtualizedTurnList.js';

const scrollToEnd = vi.fn();
const scrollToIndex = vi.fn();
const measureElement = vi.fn();
const getVirtualItems = vi.fn(() => [
  { key: 'turn-0', index: 0, start: 0, size: 180 }
]);
const getTotalSize = vi.fn(() => 180);

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: {
    anchorTo?: string;
    followOnAppend?: boolean;
    scrollEndThreshold?: number;
  }) => ({
    getVirtualItems,
    getTotalSize,
    measureElement,
    scrollToEnd,
    scrollToIndex,
    isAtEnd: () => true,
    options: opts
  })
}));

function makeSegment(key: string): DisplayRow[] {
  return [{ kind: 'user-prompt', key, id: key, content: `prompt ${key}` }];
}

describe('VirtualizedTurnList', () => {
  beforeEach(() => {
    scrollToEnd.mockClear();
    scrollToIndex.mockClear();
  });

  it('renders virtual turn rows inside a sized container', () => {
    const containerRef = createRef<HTMLDivElement>();
    const { container } = render(
      <div ref={containerRef}>
        <VirtualizedTurnList
          containerRef={containerRef}
          turnSegments={[makeSegment('p1'), makeSegment('p2')]}
          tailScrollKey="2:100"
          renderTurn={(segment) => (
            <div data-testid="turn">{segment[0]?.kind}</div>
          )}
        />
      </div>
    );

    expect(container.querySelector('[data-virtual-turn-index="0"]')).not.toBeNull();
    expect(getTotalSize).toHaveBeenCalled();
  });

  it('exposes pin and scroll helpers via ref', () => {
    const containerRef = createRef<HTMLDivElement>();
    const pinRef = createRef<TimelinePinHandle>(null);

    render(
      <div ref={containerRef} className="vx-timeline-scroll-host" style={{ overflow: 'auto', height: 400 }}>
        <VirtualizedTurnList
          ref={pinRef}
          containerRef={containerRef}
          turnSegments={[makeSegment('p1')]}
          tailScrollKey="1:0"
          renderTurn={() => <div>turn</div>}
        />
      </div>
    );

    pinRef.current?.pinToTail();
    expect(scrollToEnd).toHaveBeenCalled();

    pinRef.current?.scrollToTurnIndex(0);
    expect(scrollToIndex).toHaveBeenCalledWith(0, {
      align: 'start',
      behavior: 'instant'
    });
  });
});
