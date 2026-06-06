/** Flat derived row count at which the timeline switches to virtualization. */
export const TIMELINE_VIRTUALIZE_THRESHOLD = 50;

/** Hysteresis: de-virtualize only after row count drops below this. */
export const TIMELINE_DEVIRTUALIZE_THRESHOLD = 40;

export function shouldUseVirtualizedTimeline(
  rowCount: number,
  currentlyVirtualized: boolean
): boolean {
  if (!currentlyVirtualized && rowCount >= TIMELINE_VIRTUALIZE_THRESHOLD) return true;
  if (currentlyVirtualized && rowCount < TIMELINE_DEVIRTUALIZE_THRESHOLD) return false;
  return currentlyVirtualized;
}

/** Rough tail-turn height from streaming growth key (`rows:growth`). */
export function estimateTailTurnHeight(tailScrollKey: string): number {
  const colon = tailScrollKey.indexOf(':');
  const growth =
    colon >= 0 ? Number.parseInt(tailScrollKey.slice(colon + 1), 10) : 0;
  if (!Number.isFinite(growth) || growth <= 0) return 180;
  return Math.min(4000, 180 + Math.floor(growth / 6));
}
