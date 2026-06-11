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

/** Rough tail-turn height from streaming growth key (`rows:lastKey:growth`). */
export function estimateTailTurnHeight(tailScrollKey: string): number {
  const parts = tailScrollKey.split(':');
  const growth = Number.parseInt(parts[parts.length - 1] ?? '0', 10);
  const base = 200;
  if (!Number.isFinite(growth) || growth <= 0) return base;
  return Math.min(4800, base + Math.floor(growth / 6));
}
