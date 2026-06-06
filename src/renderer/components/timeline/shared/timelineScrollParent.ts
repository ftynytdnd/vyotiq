/** Walk ancestors to find the timeline's overflow scroll host (ChatPage column). */
export function findTimelineScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return cur;
    cur = cur.parentElement;
  }
  return null;
}
