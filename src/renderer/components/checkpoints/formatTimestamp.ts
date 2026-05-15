/**
 * Compact human-friendly timestamp for the Checkpoints view.
 * "Today 14:32", "Yesterday 09:15", "May 8 11:04", "2025 Dec 3 22:07".
 */

const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});
const SAME_YEAR_DATE = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric'
});
const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today ${SHORT_TIME.format(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday ${SHORT_TIME.format(d)}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${SAME_YEAR_DATE.format(d)} ${SHORT_TIME.format(d)}`;
  }
  return `${FULL_DATE.format(d)} ${SHORT_TIME.format(d)}`;
}
