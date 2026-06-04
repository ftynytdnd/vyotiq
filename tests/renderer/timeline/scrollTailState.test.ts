import { describe, expect, it } from 'vitest';
import { measureTimelineScrollTail } from '@renderer/components/timeline/shared/scrollTailState';

function mockScrollParent(overrides: Partial<HTMLElement>): HTMLElement {
  return {
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 576,
    ...overrides
  } as HTMLElement;
}

describe('measureTimelineScrollTail', () => {
  it('treats short transcripts as at-tail and not scrollable', () => {
    const parent = mockScrollParent({ scrollHeight: 300, clientHeight: 800, scrollTop: 0 });
    expect(measureTimelineScrollTail(parent)).toEqual({
      atTail: true,
      scrollable: false,
      distanceFromBottom: -500
    });
  });

  it('detects when the user has scrolled away from the bottom', () => {
    const parent = mockScrollParent({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    expect(measureTimelineScrollTail(parent).scrollable).toBe(true);
    expect(measureTimelineScrollTail(parent).atTail).toBe(false);
    expect(measureTimelineScrollTail(parent).distanceFromBottom).toBe(600);
  });

  it('detects when the user is pinned to the bottom', () => {
    const parent = mockScrollParent({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    expect(measureTimelineScrollTail(parent).atTail).toBe(true);
    expect(measureTimelineScrollTail(parent).distanceFromBottom).toBe(0);
  });
});
