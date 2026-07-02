/**
 * Compact scheduled-run labels for dock popover rows.
 */

import type { ScheduledRun } from '../types/scheduledRun.js';

const INTERVAL_LABELS: Readonly<Record<number, string>> = {
  5: 'Every 5 minutes',
  15: 'Every 15 minutes',
  30: 'Every 30 minutes',
  60: 'Hourly',
  120: 'Every 2 hours',
  360: 'Every 6 hours',
  1440: 'Daily'
};

export function formatScheduledRunInterval(minutes: number): string {
  return INTERVAL_LABELS[minutes] ?? `Every ${minutes} minutes`;
}

export function formatScheduledRunDueLine(run: ScheduledRun, now = Date.now()): string {
  if (!run.enabled) return 'Disabled';
  const dueAt = run.nextRunAt ?? run.createdAt;
  if (now >= dueAt) return 'Due now';
  const mins = Math.max(1, Math.round((dueAt - now) / 60_000));
  if (mins < 60) return `Due in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Due in ${days}d`;
}

export function formatScheduledRunDockSubtitle(run: ScheduledRun, now = Date.now()): string {
  const interval = formatScheduledRunInterval(run.intervalMinutes);
  const due = formatScheduledRunDueLine(run, now);
  return `${interval} · ${due}`;
}
