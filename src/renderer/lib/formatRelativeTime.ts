/**
 * Compact relative time for dock session rows (e.g. "4m", "9h", "3d").
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(updatedAt: number, now = Date.now()): string {
  const delta = Math.max(0, now - updatedAt);
  if (delta < MINUTE_MS) return 'now';
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h`;
  if (delta < DAY_MS * 7) return `${Math.floor(delta / DAY_MS)}d`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
