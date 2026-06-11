/** Slack used by Timeline sticky / jump-to-latest logic (px). */
export const TIMELINE_SCROLL_RESTICK_PX = 24;
export const TIMELINE_SCROLL_UNSTICK_PX = 80;
/** While a run is streaming, follow tail unless the user scrolls farther up. */
export const TIMELINE_SCROLL_STREAM_FOLLOW_PX = 160;

/** Minimum overflow before the transcript is considered scrollable. */
const SCROLLABLE_EPSILON_PX = 2;

export interface TimelineScrollTailState {
  /** User viewport is pinned to the bottom of the scroll parent. */
  atTail: boolean;
  /** Content height exceeds the viewport — jumping would move the view. */
  scrollable: boolean;
  /** Distance from scroll bottom (px). */
  distanceFromBottom: number;
}

export function measureTimelineScrollTail(parent: HTMLElement): TimelineScrollTailState {
  const distanceFromBottom = parent.scrollHeight - (parent.scrollTop + parent.clientHeight);
  const scrollable = parent.scrollHeight > parent.clientHeight + SCROLLABLE_EPSILON_PX;
  const atTail = !scrollable || distanceFromBottom <= TIMELINE_SCROLL_RESTICK_PX;
  return { atTail, scrollable, distanceFromBottom };
}
