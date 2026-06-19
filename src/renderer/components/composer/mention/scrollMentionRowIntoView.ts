/**
 * Scroll a mention picker row into view within its list container only.
 * Avoids `scrollIntoView`, which can scroll the timeline or page behind the popover.
 */

export function scrollMentionRowIntoView(
  container: HTMLElement | null,
  rowEl: HTMLElement | null
): void {
  if (!container || !rowEl) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = rowEl.getBoundingClientRect();

  if (rowRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - rowRect.top;
    return;
  }

  if (rowRect.bottom > containerRect.bottom) {
    container.scrollTop += rowRect.bottom - containerRect.bottom;
  }
}
