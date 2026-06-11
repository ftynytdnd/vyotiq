import { describe, expect, it } from 'vitest';
import {
  estimateTailTurnHeight,
  shouldUseVirtualizedTimeline,
  TIMELINE_DEVIRTUALIZE_THRESHOLD,
  TIMELINE_VIRTUALIZE_THRESHOLD
} from '@renderer/components/timeline/shared/timelineVirtualize.js';

describe('timelineVirtualize', () => {
  it('enables virtualization at threshold', () => {
    expect(shouldUseVirtualizedTimeline(TIMELINE_VIRTUALIZE_THRESHOLD, false)).toBe(true);
  });

  it('keeps virtualization until de-virtualize threshold', () => {
    expect(
      shouldUseVirtualizedTimeline(TIMELINE_DEVIRTUALIZE_THRESHOLD, true)
    ).toBe(true);
    expect(
      shouldUseVirtualizedTimeline(TIMELINE_DEVIRTUALIZE_THRESHOLD - 1, true)
    ).toBe(false);
  });

  it('estimates taller tail turns for streaming growth', () => {
    expect(estimateTailTurnHeight('12:0')).toBe(200);
    expect(estimateTailTurnHeight('12:600')).toBeGreaterThan(200);
    expect(estimateTailTurnHeight('12:600')).toBeLessThanOrEqual(4800);
  });
});
